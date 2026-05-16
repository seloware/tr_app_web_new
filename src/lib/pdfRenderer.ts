/**
 * PDF sayfa render yardımcıları — PDF.js üzerinde çalışır.
 * Canvas'a render edip JPEG data URL veya inline base64 döner.
 */
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc =
  `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

export type PDFProxy = pdfjsLib.PDFDocumentProxy;

export async function loadPDFFromURL(url: string): Promise<PDFProxy> {
  return pdfjsLib.getDocument({ url, cMapPacked: true }).promise;
}

export async function loadPDFFromFile(file: File): Promise<PDFProxy> {
  const buffer = await file.arrayBuffer();
  return pdfjsLib.getDocument({ data: new Uint8Array(buffer), cMapPacked: true }).promise;
}

/** PDF sayfasını canvas'a render edip JPEG data URL olarak döner */
export async function renderPageToDataURL(
  pdf: PDFProxy,
  pageNum: number,
  scale = 1.5,
): Promise<string> {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL('image/jpeg', 0.85);
}

/** data URL'den base64 gövdesini çıkarır (mimeType dahil) */
export function dataURLToInline(dataURL: string): { mimeType: string; data: string } {
  const [header, data] = dataURL.split(',');
  const mimeType = header.match(/:(.*?);/)?.[1] ?? 'image/jpeg';
  return { mimeType, data };
}

/** data URL'yi File nesnesine çevirir (AI attachment olarak göndermek için) */
export async function dataURLToFile(dataURL: string, name: string): Promise<File> {
  const res = await fetch(dataURL);
  const blob = await res.blob();
  return new File([blob], name, { type: blob.type });
}
