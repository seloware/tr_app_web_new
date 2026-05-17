/**
 * PDF Translator — Yeni nesil çeviri pipeline'ı
 *
 * Tek görev: PDF'den metin koordinatlarını çıkar, AI ile çevir, OverlayPage[] döndür.
 * Görsel/grafik analizi YOK — sadece metin. Grafik/resimler orijinal PDF'de zaten
 * korunur (pdfWriter.ts vector-preserving yazıyor).
 *
 * Aşamalar:
 *  1. Metin çıkarma (PyMuPDF servisi varsa, yoksa PDF.js fallback)
 *  2. Sayfa başına paralel çeviri (translateTextBlocks)
 *  3. İlerleme bildirimi: zengin, çok aşamalı, ETA'lı
 */
import {
  loadPDFFromFile,
  loadPDFFromURL,
  type PDFProxy,
} from './pdfRenderer';
import { extractTextLines } from './pdfTextExtractor';
import { translateTextBlocks } from './ai';
import { extractPDFPages, type ServicePageData } from './pdfExtractorService';
import type { OverlayPage, OverlayBlock } from '../types';

const CONCURRENCY = 3;
const MAX_ATTEMPTS = 3;

export type TranslationPhase =
  | 'loading'      // PDF açılıyor
  | 'extracting'   // Sayfa metni çıkarılıyor
  | 'translating'  // AI çeviri yapıyor
  | 'finalizing'   // Yazma için hazırlanıyor
  | 'completed';

export interface TranslationProgress {
  phase: TranslationPhase;
  current: number;
  total: number;
  message: string;
  estimatedSecondsLeft?: number;
  /** Sayfa-bazında durum: 0=bekliyor, 1=çıkarılıyor, 2=çevriliyor, 3=bitti, 4=hata */
  pageStatuses?: Uint8Array;
}

export interface TranslateOptions {
  sourceLang: string;
  targetLang?: string;
  onProgress?: (p: TranslationProgress) => void;
  signal?: AbortSignal;
}

export interface TranslationResult {
  pages: OverlayPage[];
  pdf: PDFProxy;
  sourceLang: string;
  targetLang: string;
}

export async function translatePDF(
  source: File | string,
  opts: TranslateOptions,
): Promise<TranslationResult> {
  const { sourceLang, targetLang = 'tr', onProgress, signal } = opts;

  onProgress?.({ phase: 'loading', current: 0, total: 0, message: 'PDF açılıyor…' });

  const pdf = typeof source === 'string'
    ? await loadPDFFromURL(source)
    : await loadPDFFromFile(source);

  if (signal?.aborted) throw new Error('İptal edildi');

  // İsteğe bağlı: PyMuPDF servisi (daha doğru koordinat)
  let servicePages: ServicePageData[] | null = null;
  if (source instanceof File) {
    try {
      servicePages = await extractPDFPages(source);
    } catch {
      // sessizce PDF.js'e düş
    }
  }

  const total = pdf.numPages;
  const pageStatuses = new Uint8Array(total);
  const result: OverlayPage[] = new Array(total);
  let completed = 0;
  const startedAt = Date.now();

  const emitProgress = (phase: TranslationPhase, message: string) => {
    const elapsed = Date.now() - startedAt;
    const avgMs = completed > 0 ? elapsed / completed : 4000;
    const remaining = total - completed;
    const etaSec = Math.ceil((remaining * avgMs) / CONCURRENCY / 1000);
    onProgress?.({
      phase,
      current: completed,
      total,
      message,
      estimatedSecondsLeft: completed > 0 ? etaSec : Math.ceil((total * 4) / CONCURRENCY),
      pageStatuses: new Uint8Array(pageStatuses),
    });
  };

  emitProgress(
    'translating',
    `${total} sayfa işlenecek${servicePages ? ' (PyMuPDF servisi aktif)' : ''}`,
  );

  const processPage = async (pageNum: number): Promise<void> => {
    if (signal?.aborted) throw new Error('İptal edildi');

    pageStatuses[pageNum - 1] = 1; // extracting
    emitProgress('translating', `Sayfa ${pageNum}: metin çıkarılıyor…`);

    // 1) Metin koordinatları
    let lines: Array<{ text: string; x: number; y: number; w: number; h: number; fontSize: number }>;
    let pageWidthPts: number;
    let pageHeightPts: number;

    const sp = servicePages?.find(p => p.pageNum === pageNum);
    if (sp) {
      lines = sp.blocks;
      pageWidthPts = sp.pageWidthPts;
      pageHeightPts = sp.pageHeightPts;
    } else {
      const r = await extractTextLines(pdf, pageNum);
      lines = r.lines;
      pageWidthPts = r.pageWidthPts;
      pageHeightPts = r.pageHeightPts;
    }

    if (signal?.aborted) throw new Error('İptal edildi');

    pageStatuses[pageNum - 1] = 2; // translating
    emitProgress('translating', `Sayfa ${pageNum}: çevriliyor (${lines.length} metin bloğu)`);

    // 2) Çeviri — sadece metin, görsel analiz yok
    let translations: string[] = lines.map(l => l.text);
    if (lines.length > 0) {
      try {
        translations = await translateTextBlocks(
          lines.map(l => l.text),
          sourceLang,
          targetLang,
          signal,
        );
      } catch (e) {
        const msg = (e as Error)?.message ?? '';
        if (msg.includes('İptal')) throw e;
        // çeviri başarısız → orijinal kalsın
      }
    }

    const blocks: OverlayBlock[] = lines.map((line, i) => ({
      x: line.x,
      y: line.y,
      w: line.w,
      h: line.h,
      fontSize: line.fontSize,
      original: line.text,
      translated: translations[i] || line.text,
    }));

    result[pageNum - 1] = { pageNum, pageWidthPts, pageHeightPts, blocks };
    pageStatuses[pageNum - 1] = 3; // done
    completed++;
    emitProgress('translating', `Sayfa ${pageNum}/${total} tamamlandı`);
  };

  const processWithRetry = async (pageNum: number): Promise<void> => {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        await processPage(pageNum);
        return;
      } catch (err) {
        const msg = (err as Error)?.message ?? '';
        if (msg === 'İptal edildi') throw err;
        if (attempt === MAX_ATTEMPTS) {
          pageStatuses[pageNum - 1] = 4;
          result[pageNum - 1] = result[pageNum - 1] ?? {
            pageNum, pageWidthPts: 595, pageHeightPts: 842, blocks: [],
          };
          completed++;
          emitProgress('translating', `Sayfa ${pageNum}: atlandı (${MAX_ATTEMPTS} deneme başarısız)`);
          return;
        }
        await new Promise(r => setTimeout(r, 1500 * attempt));
      }
    }
  };

  // Sayfa kuyruğu + worker havuzu
  const queue = Array.from({ length: total }, (_, i) => i + 1);
  const worker = async () => {
    while (queue.length > 0) {
      if (signal?.aborted) throw new Error('İptal edildi');
      const pageNum = queue.shift()!;
      await processWithRetry(pageNum);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, total) }, () => worker()),
  );

  emitProgress('finalizing', 'Çeviri tamamlandı, kaydediliyor…');

  onProgress?.({
    phase: 'completed',
    current: total,
    total,
    message: 'Tüm sayfalar çevrildi',
    pageStatuses: new Uint8Array(pageStatuses),
  });

  return { pages: result, pdf, sourceLang, targetLang };
}

/** Overlay'den düz metin üretir (DOCX/TXT/markdown export için) */
export function overlayToText(pages: OverlayPage[]): string {
  return pages
    .map(p => {
      const lines = [...p.blocks]
        .sort((a, b) => a.y - b.y || a.x - b.x)
        .map(b => b.translated);
      return lines.join('\n');
    })
    .join('\n\n---\n\n');
}
