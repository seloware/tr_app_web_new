/**
 * PDF Overlay Exporter
 *
 * Overlay verisi + orijinal PDF'den çevrilmiş PDF üretir:
 *  - Her sayfa için orijinal görüntü background olarak yerleştirilir
 *  - Her metin bloğunun üstüne hafif arka planlı çeviri yazılır
 *  - jsPDF kullanarak çok sayfalı PDF üretilir
 */
import jsPDF from 'jspdf';
import { loadPDFFromURL, renderPageToDataURL, type PDFProxy } from './pdfRenderer';
import type { OverlayPage } from '../types';

export interface ExportOptions {
  onProgress?: (current: number, total: number) => void;
  signal?: AbortSignal;
  filename?: string;
}

export async function exportOverlayToPDF(
  pdfSource: string | PDFProxy, // URL veya yüklenmiş PDF
  overlayPages: OverlayPage[],
  opts: ExportOptions = {},
): Promise<Blob> {
  const { onProgress, signal, filename = 'ceviri.pdf' } = opts;

  const pdf: PDFProxy = typeof pdfSource === 'string'
    ? await loadPDFFromURL(pdfSource)
    : pdfSource;

  const total = overlayPages.length;
  let doc: jsPDF | null = null;

  for (let i = 0; i < total; i++) {
    if (signal?.aborted) throw new Error('İptal edildi');

    const overlay = overlayPages[i];
    const pageNum = overlay.pageNum;

    // Sayfayı yüksek kalitede render et
    const imageDataURL = await renderPageToDataURL(pdf, pageNum, 2.0);

    const W = overlay.pageWidthPts;
    const H = overlay.pageHeightPts;
    const orientation = W > H ? 'landscape' : 'portrait';

    if (!doc) {
      doc = new jsPDF({
        orientation,
        unit: 'pt',
        format: [W, H],
        compress: true,
      });
    } else {
      doc.addPage([W, H], orientation);
    }

    // 1. Arka plan: orijinal sayfa görüntüsü (tüm grafik/şekil korunur)
    doc.addImage(imageDataURL, 'JPEG', 0, 0, W, H, undefined, 'FAST');

    // 2. Çeviri katmanı: her blok için beyazımsı kutu + çeviri metni
    for (const block of overlay.blocks) {
      const x = block.x * W;
      const y = block.y * H;
      const w = block.w * W;
      const h = Math.max(block.h * H, block.fontSize * 1.1);

      // Orijinal metni örtmek için hafif sarımsı/beyaz kutu
      doc.setFillColor(255, 252, 235);
      doc.setDrawColor(220, 200, 110);
      doc.setLineWidth(0.3);
      doc.rect(x - 1, y - 1, w + 2, h + 2, 'F');

      // Çevirilmiş metin
      doc.setTextColor(20, 20, 36);
      // jsPDF helvetica default, Türkçe karakterler için yeterli
      doc.setFont('helvetica', 'normal');
      // Font boyutu: PDF.js scale=1 ile aynı (pts cinsinden)
      doc.setFontSize(block.fontSize * 0.9);

      const text = block.translated;
      const maxWidth = w - 1;
      const lines = doc.splitTextToSize(text, maxWidth);
      const lineHeight = block.fontSize * 1.15;

      // Metni kutu içinde yerleştir (baseline kaydırması için fontSize * 0.85)
      let cursorY = y + block.fontSize * 0.85;
      for (const line of lines) {
        if (cursorY > y + h + block.fontSize) break; // kutudan taşma
        doc.text(line, x, cursorY);
        cursorY += lineHeight;
      }
    }

    onProgress?.(i + 1, total);
  }

  if (!doc) throw new Error('PDF üretilemedi');

  return doc.output('blob');
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
