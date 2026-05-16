/**
 * PDF Overlay Builder
 *
 * Bir PDF dosyasını alıp her sayfayı paralel olarak işler:
 *  1. Sayfayı canvas'a render et (orijinal grafik/şekil korunur)
 *  2. PDF.js ile metin koordinatlarını çıkar
 *  3. Sayfa görüntüsü + metinler → Gemini Pro (vision)
 *     → metin çevirisi + grafik içi yazı çevirisi
 *  4. Tüm verileri OverlayPage[] olarak biriktir
 *
 * Sonuç bir kez üretilir, Supabase'e kaydedilir, sonraki açılışlarda anında gösterilir.
 */
import {
  loadPDFFromFile,
  loadPDFFromURL,
  renderPageToDataURL,
  type PDFProxy,
} from './pdfRenderer';
import { extractTextLines } from './pdfTextExtractor';
import { translatePageWithVision } from './ai';
import type { OverlayPage, OverlayBlock } from '../types';

// Aynı anda işlenecek maksimum sayfa sayısı (API rate limit + tarayıcı CPU dengesi)
const CONCURRENCY = 3;

export interface BuildProgress {
  phase: 'loading' | 'translating' | 'completed';
  current: number;        // tamamlanan sayfa
  total: number;
  message: string;
  estimatedSecondsLeft?: number;
}

export interface BuildOptions {
  sourceLang: string;
  targetLang?: string;
  onProgress?: (p: BuildProgress) => void;
  signal?: AbortSignal;
  /** İşlem başına yaklaşık süre (ms) — kalan süre tahmini için */
  msPerPageEstimate?: number;
}

export async function buildOverlayFromPDF(
  source: File | string, // File ya da Supabase signed URL
  opts: BuildOptions,
): Promise<{ pages: OverlayPage[]; pdf: PDFProxy }> {
  const { sourceLang, targetLang = 'tr', onProgress, signal } = opts;
  const msPerPage = opts.msPerPageEstimate ?? 4000;

  onProgress?.({ phase: 'loading', current: 0, total: 0, message: 'PDF yükleniyor...' });

  const pdf = typeof source === 'string'
    ? await loadPDFFromURL(source)
    : await loadPDFFromFile(source);

  if (signal?.aborted) throw new Error('İptal edildi');

  const total = pdf.numPages;
  const result: OverlayPage[] = new Array(total);
  let completed = 0;
  const startTime = Date.now();

  onProgress?.({
    phase: 'translating',
    current: 0,
    total,
    message: `${total} sayfa işlenecek (~${Math.ceil((total * msPerPage) / (CONCURRENCY * 1000))} sn)`,
    estimatedSecondsLeft: Math.ceil((total * msPerPage) / (CONCURRENCY * 1000)),
  });

  // Page numarası kuyruğu (1-indexed)
  const queue = Array.from({ length: total }, (_, i) => i + 1);

  const processPage = async (pageNum: number): Promise<void> => {
    if (signal?.aborted) throw new Error('İptal edildi');

    try {
      // 1. Render (1.4x — vision için yeterli, hız için fazla değil)
      const imageDataURL = await renderPageToDataURL(pdf, pageNum, 1.4);
      if (signal?.aborted) throw new Error('İptal edildi');

      // 2. Metin koordinatlarını çıkar
      const extract = await extractTextLines(pdf, pageNum);
      if (signal?.aborted) throw new Error('İptal edildi');

      // 3. Çeviri (vision + metin)
      let blocks: OverlayBlock[] = [];
      if (extract.lines.length > 0 || true) { // her sayfa için vision çağrısı yap (visual text de tespit etmesi için)
        const { textTranslations, visualBlocks } = await translatePageWithVision(
          imageDataURL,
          extract.lines,
          sourceLang,
          targetLang,
          signal,
        );

        // PDF.js'ten çıkan metinler (pozisyon güvenilir)
        blocks = extract.lines.map((line, i) => ({
          x: line.x,
          y: line.y,
          w: line.w,
          h: line.h,
          fontSize: line.fontSize,
          original: line.text,
          translated: textTranslations[i] || line.text,
        }));

        // Grafik içi yazılar (best-effort, Gemini'den gelen pozisyonlar)
        for (const v of visualBlocks) {
          // Çakışma kontrolü: zaten PDF.js'te varsa atla
          const overlapsExisting = blocks.some(b =>
            Math.abs(b.x - v.x) < 0.02 &&
            Math.abs(b.y - v.y) < 0.02 &&
            b.original.toLowerCase().includes(v.original.toLowerCase().slice(0, 10))
          );
          if (!overlapsExisting) {
            blocks.push({ ...v, visual: true });
          }
        }
      }

      result[pageNum - 1] = {
        pageNum,
        pageWidthPts: extract.pageWidthPts,
        pageHeightPts: extract.pageHeightPts,
        blocks,
      };
    } catch (err) {
      // Bir sayfada hata olursa boş bırak (kullanıcı yine de açabilsin)
      if ((err as Error)?.message === 'İptal edildi') throw err;
      console.warn(`Sayfa ${pageNum} işlenemedi:`, err);
      result[pageNum - 1] = {
        pageNum,
        pageWidthPts: 595,
        pageHeightPts: 842,
        blocks: [],
      };
    }

    completed++;
    const elapsed = Date.now() - startTime;
    const avgMsPerPage = elapsed / completed;
    const remaining = total - completed;
    const etaSec = Math.ceil((remaining * avgMsPerPage) / CONCURRENCY / 1000);

    onProgress?.({
      phase: 'translating',
      current: completed,
      total,
      message: `Sayfa ${completed}/${total} tamamlandı`,
      estimatedSecondsLeft: etaSec,
    });
  };

  // Paralel worker havuzu
  const worker = async () => {
    while (queue.length > 0) {
      if (signal?.aborted) throw new Error('İptal edildi');
      const pageNum = queue.shift()!;
      await processPage(pageNum);
    }
  };

  const workers = Array.from({ length: Math.min(CONCURRENCY, total) }, () => worker());
  await Promise.all(workers);

  onProgress?.({
    phase: 'completed',
    current: total,
    total,
    message: 'Çeviri tamamlandı',
  });

  return { pages: result, pdf };
}

/** Overlay verisinden markdown çıktısı üretir (indirme + arama için) */
export function overlayToMarkdown(pages: OverlayPage[]): string {
  return pages
    .map(p => {
      const lines = [...p.blocks]
        .filter(b => !b.visual)
        .sort((a, b) => a.y - b.y || a.x - b.x)
        .map(b => b.translated);
      return lines.join('\n');
    })
    .join('\n\n---\n\n');
}
