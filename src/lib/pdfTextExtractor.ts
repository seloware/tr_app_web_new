/**
 * PDF metin bloklarını PDF.js koordinat sisteminden çıkarır.
 * Her metin satırı için: orijinal metin + sayfa üzerindeki kesin konum (0-1 oranı)
 *
 * PDF koordinat sistemi: sol-alt köşe origin, y yukarı artar.
 * HTML/Canvas: sol-üst köşe origin, y aşağı artar.
 * Bu modül ikisi arasındaki dönüşümü gerçekleştirir.
 */
import type { PDFProxy } from './pdfRenderer';

export interface TextLine {
  text: string;
  x: number;        // 0-1, page width ratio, from left
  y: number;        // 0-1, page height ratio, from TOP
  w: number;        // 0-1, page width ratio
  h: number;        // 0-1, page height ratio
  fontSize: number; // font size in PDF pts (at scale=1)
}

export interface ExtractResult {
  lines: TextLine[];
  pageWidthPts: number;
  pageHeightPts: number;
}

export async function extractTextLines(
  pdf: PDFProxy,
  pageNum: number,
): Promise<ExtractResult> {
  const page = await pdf.getPage(pageNum);
  // scale=1 → koordinatlar doğrudan PDF pts cinsinden
  const viewport = page.getViewport({ scale: 1 });
  const W = viewport.width;
  const H = viewport.height;

  const content = await page.getTextContent();

  const raw: Array<{
    text: string;
    x: number;    // ratio
    y: number;    // ratio from top
    w: number;    // ratio
    h: number;    // ratio
    fs: number;   // font size pts
  }> = [];

  for (const item of content.items) {
    if (!('str' in item)) continue;
    const str = item.str.trim();
    if (!str) continue;

    // PDF transform matrix: [a, b, c, d, tx, ty]
    // tx = x from left edge (pts), ty = y from BOTTOM edge (pts)
    const tx = item.transform;
    const ptX = tx[4];
    const ptY = tx[5]; // distance from BOTTOM

    // Font size: vertical scale component of the transform matrix
    const fs = Math.abs(tx[3]) || Math.abs(tx[0]) || item.height || 10;

    // Height of this item (in pts)
    const itemH = item.height > 0 ? item.height : fs;

    // Convert y from bottom-origin to top-origin
    const yFromTop = H - ptY - itemH;

    // Clamp to page bounds (some PDFs have out-of-bounds items)
    if (ptX < -5 || ptX > W + 5 || yFromTop < -5 || yFromTop > H + 5) continue;

    raw.push({
      text: str,
      x: Math.max(0, ptX) / W,
      y: Math.max(0, yFromTop) / H,
      w: Math.max(0.005, (item.width || fs * 0.6 * str.length)) / W,
      h: Math.max(0.005, itemH) / H,
      fs,
    });
  }

  // ── Aynı satırdaki öğeleri birleştir ──────────────────────────────────────
  // Y farkı < %1.5 ise aynı satır kabul edilir
  raw.sort((a, b) => {
    const dy = a.y - b.y;
    return Math.abs(dy) < 0.015 ? a.x - b.x : dy;
  });

  const LINE_Y_THRESH = 0.018;
  const groups: (typeof raw)[] = [];
  let cur: typeof raw = [];

  for (const item of raw) {
    if (cur.length === 0 || Math.abs(item.y - cur[0].y) < LINE_Y_THRESH) {
      cur.push(item);
    } else {
      groups.push(cur);
      cur = [item];
    }
  }
  if (cur.length > 0) groups.push(cur);

  const lines: TextLine[] = groups
    .map(g => mergeGroup(g))
    .filter(l => l.text.length > 0);

  return { lines, pageWidthPts: W, pageHeightPts: H };
}

function mergeGroup(
  g: Array<{ text: string; x: number; y: number; w: number; h: number; fs: number }>,
): TextLine {
  const text = g.map(i => i.text).join(' ').trim();
  const x = Math.min(...g.map(i => i.x));
  const y = Math.min(...g.map(i => i.y));
  const xRight = Math.max(...g.map(i => i.x + i.w));
  const yBottom = Math.max(...g.map(i => i.y + i.h));
  const fontSize = Math.max(...g.map(i => i.fs));
  return { text, x, y, w: Math.min(xRight - x, 0.98), h: yBottom - y, fontSize };
}
