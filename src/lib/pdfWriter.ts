/**
 * PDF Writer — Vektör-koruyucu, kutusuz yeniden yazıcı (v2)
 *
 * Strateji (hibrit):
 *   1. PRIMARY: Backend PyMuPDF servisi — gerçek redaction (Adobe-quality)
 *      • Orijinal metin PDF içeriğinden FİZİKSEL silinir
 *      • Beyaz kutu / overlay yok — sayfa arka planı korunur
 *      • Vektör grafikler ve resimler dokunulmaz
 *   2. FALLBACK: pdf-lib + arka plan rengi örnekleme
 *      • Backend yoksa: her metin bloğunun arka plan rengi pixel'den örneklenir
 *      • O renkle "kutu" çizilir → beyaz değil, sayfayla uyumlu renk
 *      • Yine de fallback olduğu için profesyonel görüntü için backend önerilir
 */
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { writePDFWithTranslations, checkServiceHealth } from './pdfExtractorService';
import type { OverlayPage } from '../types';

let cachedFontBytes: ArrayBuffer | null = null;
let cachedBoldBytes: ArrayBuffer | null = null;

async function loadFont(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Font yüklenemedi: ${url}`);
  return res.arrayBuffer();
}

async function getUnicodeFont(): Promise<ArrayBuffer> {
  if (cachedFontBytes) return cachedFontBytes;
  cachedFontBytes = await loadFont('/fonts/NotoSans-Regular.ttf');
  return cachedFontBytes;
}
async function getUnicodeBoldFont(): Promise<ArrayBuffer> {
  if (cachedBoldBytes) return cachedBoldBytes;
  cachedBoldBytes = await loadFont('/fonts/NotoSans-Bold.ttf');
  return cachedBoldBytes;
}

export interface WriteOptions {
  originalPDF: File | ArrayBuffer | Uint8Array;
  pages: OverlayPage[];
  onProgress?: (current: number, total: number) => void;
  signal?: AbortSignal;
  /** Kullanıcı backend'i bilerek atla isterse true */
  preferLocal?: boolean;
}

const BLACK = rgb(0.06, 0.06, 0.10);

/**
 * Metni kutuya sığdırmak için font boyutunu hesaplar (çok satırlı).
 */
function fitFontSize(
  text: string,
  font: import('pdf-lib').PDFFont,
  boxW: number,
  boxH: number,
  startSize: number,
): { fontSize: number; lines: string[] } {
  const minSize = 4;
  let size = startSize;

  const wrap = (fs: number): string[] => {
    const lineHeight = fs * 1.15;
    const maxLines = Math.max(1, Math.floor(boxH / lineHeight));
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length === 0) return [''];

    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      const candidate = cur ? `${cur} ${w}` : w;
      const width = font.widthOfTextAtSize(candidate, fs);
      if (width <= boxW) cur = candidate;
      else {
        if (cur) lines.push(cur);
        if (font.widthOfTextAtSize(w, fs) > boxW) {
          let buf = '';
          for (const ch of w) {
            const trial = buf + ch;
            if (font.widthOfTextAtSize(trial, fs) <= boxW) buf = trial;
            else {
              if (buf) lines.push(buf);
              buf = ch;
            }
          }
          cur = buf;
        } else cur = w;
        if (lines.length >= maxLines) break;
      }
    }
    if (cur && lines.length < maxLines) lines.push(cur);
    return lines;
  };

  while (size >= minSize) {
    const lines = wrap(size);
    const lineHeight = size * 1.15;
    if (lines.length * lineHeight <= boxH * 1.05 && lines.length > 0) {
      return { fontSize: size, lines };
    }
    size -= 0.5;
  }
  return { fontSize: minSize, lines: wrap(minSize) };
}

/**
 * Sayfanın belirli bölgesinde arka plan rengini örnekler.
 * Metin alanının kenarlarındaki pixel'lerden ortalama RGB hesaplar.
 *
 * Bu sayede beyaz olmayan arka planlar (gradient, renkli sayfa, taranmış kağıt)
 * için doğal görünümlü doldurma rengi elde edilir.
 */
async function sampleBackgroundColors(
  pdfBytes: Uint8Array,
  pages: OverlayPage[],
): Promise<Map<string, [number, number, number]>> {
  // PDF.js dinamik import — sadece fallback'te gerekiyor
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

  const result = new Map<string, [number, number, number]>();
  const SCALE = 1.5;

  const pdf = await pdfjsLib.getDocument({ data: pdfBytes.slice() }).promise;

  for (const overlayPage of pages) {
    if (!overlayPage.blocks.length) continue;
    try {
      const page = await pdf.getPage(overlayPage.pageNum);
      const viewport = page.getViewport({ scale: SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      await page.render({ canvasContext: ctx, viewport }).promise;

      for (let i = 0; i < overlayPage.blocks.length; i++) {
        const b = overlayPage.blocks[i];
        // Pixel koordinatları (canvas SCALE'inde)
        const px = Math.max(0, Math.floor(b.x * canvas.width));
        const py = Math.max(0, Math.floor(b.y * canvas.height));
        const pw = Math.max(1, Math.floor(b.w * canvas.width));
        const ph = Math.max(1, Math.floor(b.h * canvas.height));

        // Kutunun ÜSTÜNDEN ve ALTINDAN ince bir şerit oku (background)
        const stripH = Math.max(2, Math.min(6, Math.floor(ph * 0.3)));
        const samples: number[][] = [];

        // Üst şerit (kutunun üstünden)
        const topY = Math.max(0, py - stripH - 1);
        if (topY < canvas.height && topY + stripH > 0) {
          try {
            const data = ctx.getImageData(px, topY, pw, stripH).data;
            for (let k = 0; k < data.length; k += 4) {
              samples.push([data[k], data[k + 1], data[k + 2]]);
            }
          } catch { /* out of bounds */ }
        }
        // Alt şerit
        const botY = py + ph + 1;
        if (botY < canvas.height) {
          try {
            const data = ctx.getImageData(px, botY, pw, Math.min(stripH, canvas.height - botY)).data;
            for (let k = 0; k < data.length; k += 4) {
              samples.push([data[k], data[k + 1], data[k + 2]]);
            }
          } catch { /* skip */ }
        }

        if (samples.length === 0) {
          result.set(`${overlayPage.pageNum}-${i}`, [255, 255, 255]);
          continue;
        }

        // Medyan benzeri: en sık tekrar eden renge yakın bir ortalama
        // Basit ortalama yeterli — text aralıkları büyük çoğunluk arka plandır
        let r = 0, g = 0, bl = 0;
        for (const s of samples) {
          r += s[0]; g += s[1]; bl += s[2];
        }
        r = Math.round(r / samples.length);
        g = Math.round(g / samples.length);
        bl = Math.round(bl / samples.length);
        result.set(`${overlayPage.pageNum}-${i}`, [r, g, bl]);
      }

      // Canvas'ı temizle (memory)
      canvas.width = 0; canvas.height = 0;
    } catch (e) {
      console.warn(`Sayfa ${overlayPage.pageNum} background sampling başarısız:`, e);
    }
  }

  return result;
}

/**
 * Ana giriş noktası: backend-first, fallback lokal.
 */
export async function buildTranslatedPDF(opts: WriteOptions): Promise<Uint8Array> {
  const { originalPDF, pages, onProgress, signal, preferLocal } = opts;

  // Byte'a çevir (her iki yol da gerek)
  let bytes: Uint8Array;
  let originalFile: File | null = null;
  if (originalPDF instanceof File) {
    bytes = new Uint8Array(await originalPDF.arrayBuffer());
    originalFile = originalPDF;
  } else if (originalPDF instanceof ArrayBuffer) {
    bytes = new Uint8Array(originalPDF);
  } else {
    bytes = originalPDF;
  }

  // ── 1) Backend redaction (tercih edilen) ──────────────────────────────────
  if (!preferLocal) {
    const healthy = await checkServiceHealth();
    if (healthy) {
      try {
        const file = originalFile ?? new File([bytes.slice().buffer as ArrayBuffer], 'document.pdf', { type: 'application/pdf' });
        const blocksByPage = pages.map(p => p.blocks.map(b => ({
          x: b.x, y: b.y, w: b.w, h: b.h,
          fontSize: b.fontSize,
          translated: b.translated,
          original: b.original,
        })));

        onProgress?.(0, pages.length);
        const blob = await writePDFWithTranslations(file, blocksByPage);
        if (blob) {
          onProgress?.(pages.length, pages.length);
          const buf = await blob.arrayBuffer();
          return new Uint8Array(buf);
        }
      } catch (e) {
        console.warn('Backend redaction başarısız, lokal fallback:', e);
      }
    }
  }

  // ── 2) Lokal fallback: pdf-lib + arka plan rengi örnekleme ────────────────
  if (signal?.aborted) throw new Error('İptal edildi');

  // Arka plan renklerini paralel örnekle
  onProgress?.(0, pages.length);
  const bgColors = await sampleBackgroundColors(bytes, pages);
  if (signal?.aborted) throw new Error('İptal edildi');

  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  pdfDoc.registerFontkit(fontkit);

  let font: import('pdf-lib').PDFFont;
  let bold: import('pdf-lib').PDFFont;
  try {
    const [r, b] = await Promise.all([getUnicodeFont(), getUnicodeBoldFont()]);
    font = await pdfDoc.embedFont(r, { subset: true });
    bold = await pdfDoc.embedFont(b, { subset: true });
  } catch {
    font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  }

  const docPages = pdfDoc.getPages();
  const total = pages.length;

  for (let i = 0; i < total; i++) {
    if (signal?.aborted) throw new Error('İptal edildi');

    const overlay = pages[i];
    const pageIdx = overlay.pageNum - 1;
    if (pageIdx < 0 || pageIdx >= docPages.length) continue;

    const docPage = docPages[pageIdx];
    const { width: W, height: H } = docPage.getSize();

    for (let bi = 0; bi < overlay.blocks.length; bi++) {
      const block = overlay.blocks[bi];
      const text = (block.translated || '').trim();
      if (!text) continue;

      const boxX = block.x * W;
      const boxYTop = block.y * H;
      const boxW = Math.max(block.w * W, 2);
      const boxH = Math.max(block.h * H, block.fontSize * 1.05);

      const rectY = H - boxYTop - boxH;

      // Arka plan rengini örnekten al, yoksa beyaz
      const sample = bgColors.get(`${overlay.pageNum}-${bi}`);
      const bgFill = sample
        ? rgb(sample[0] / 255, sample[1] / 255, sample[2] / 255)
        : rgb(1, 1, 1);

      // Background rengiyle örtme — beyaz değil sayfaya uyumlu renk
      docPage.drawRectangle({
        x: boxX - 1,
        y: rectY - 0.5,
        width: boxW + 2,
        height: boxH + 1,
        color: bgFill,
        opacity: 1,
        borderWidth: 0,
      });

      // Çevirilmiş metin
      const startSize = Math.min(block.fontSize, boxH / 1.15);
      const usedFont = startSize >= 11 ? bold : font;
      const { fontSize, lines } = fitFontSize(text, usedFont, boxW - 1, boxH, startSize);
      const lineHeight = fontSize * 1.15;

      // Metin rengi: background koyu ise beyaz, açık ise siyah
      const bgLuma = sample ? (0.299 * sample[0] + 0.587 * sample[1] + 0.114 * sample[2]) / 255 : 1;
      const textColor = bgLuma < 0.5 ? rgb(0.95, 0.95, 0.95) : BLACK;

      let baselineFromTop = boxYTop + fontSize * 0.85;
      for (const line of lines) {
        docPage.drawText(line, {
          x: boxX,
          y: H - baselineFromTop,
          size: fontSize,
          font: usedFont,
          color: textColor,
        });
        baselineFromTop += lineHeight;
        if (baselineFromTop - boxYTop > boxH + fontSize) break;
      }
    }

    onProgress?.(i + 1, total);
  }

  const out = await pdfDoc.save({ useObjectStreams: true });
  return out;
}

export function downloadBytes(bytes: Uint8Array, filename: string, mime = 'application/pdf') {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const blob = new Blob([buffer as ArrayBuffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
