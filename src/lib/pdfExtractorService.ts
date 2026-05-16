/**
 * Python PDF Servis İstemcisi
 *
 * VITE_PDF_SERVICE_URL ayarlıysa PyMuPDF (fitz) tabanlı Python servisi kullanılır.
 * Bu servis PDF.js'ten çok daha doğru koordinat ve font bilgisi verir.
 *
 * Ayarlı değilse tüm fonksiyonlar null döner → caller PDF.js'e geri döner.
 *
 * Kurulum:
 *   cd backend && pip install -r requirements.txt
 *   uvicorn main:app --reload --port 5050
 *
 * .env.local:
 *   VITE_PDF_SERVICE_URL=http://localhost:5050
 */

const SERVICE_URL = (import.meta.env.VITE_PDF_SERVICE_URL as string | undefined)?.replace(/\/$/, '');

export function isPDFServiceAvailable(): boolean {
  return !!SERVICE_URL;
}

export interface ServiceTextBlock {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize: number;
  fontName: string;
  bold: boolean;
}

export interface ServicePageData {
  pageNum: number;
  pageWidthPts: number;
  pageHeightPts: number;
  blocks: ServiceTextBlock[];
}

/**
 * PDF dosyasından tüm sayfaların metin bloklarını PyMuPDF ile çıkarır.
 * Başarısız olursa null döner (caller PDF.js'e geçer).
 */
export async function extractPDFPages(file: File): Promise<ServicePageData[] | null> {
  if (!SERVICE_URL) return null;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch(`${SERVICE_URL}/extract`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      console.warn(`PDF servisi /extract hatası: HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    return data.pages as ServicePageData[];
  } catch (e) {
    console.warn('PDF servisine ulaşılamıyor, PDF.js kullanılıyor:', e);
    return null;
  }
}

/**
 * Belirtilen sayfayı Python servisiyle render eder.
 * Başarısız olursa null döner (caller PDF.js render kullanır).
 */
export async function renderPageWithService(
  file: File,
  pageNum: number,
  scale = 1.5,
): Promise<string | null> {
  if (!SERVICE_URL) return null;

  const formData = new FormData();
  formData.append('file', file);
  formData.append('page_num', String(pageNum));
  formData.append('scale', String(scale));

  try {
    const res = await fetch(`${SERVICE_URL}/render-page`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.imageDataURL as string;
  } catch {
    return null;
  }
}

/**
 * Çevrilmiş overlay bloklarını PDF'e doğrudan yazar.
 * PyMuPDF font-scaling ile orijinal bounding box'a tam sığdırır.
 * Başarısız olursa null döner (caller jsPDF overlay yöntemini kullanır).
 */
export async function writePDFWithTranslations(
  file: File,
  pages: Array<Array<{
    x: number; y: number; w: number; h: number;
    fontSize: number; translated: string; original: string;
  }>>,
): Promise<Blob | null> {
  if (!SERVICE_URL) return null;

  const formData = new FormData();
  formData.append('file', file);
  formData.append('pages_json', JSON.stringify(pages));

  try {
    const res = await fetch(`${SERVICE_URL}/write-pdf`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

/** Servisin çalışıp çalışmadığını kontrol eder */
export async function checkServiceHealth(): Promise<boolean> {
  if (!SERVICE_URL) return false;
  try {
    const res = await fetch(`${SERVICE_URL}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}
