"""
TransLingua PDF Extraction Service
===================================
PyMuPDF (fitz) ile PDF'den kesin koordinat ve font bilgisi çıkarır.
PDF.js'ten çok daha doğru bounding box verir.

Kurulum:
    pip install -r requirements.txt

Çalıştırma:
    uvicorn main:app --reload --port 5050

Frontend kullanımı:
    .env.local'e ekle: VITE_PDF_SERVICE_URL=http://localhost:5050
"""

import io
import base64
import json
from typing import Optional

import fitz  # PyMuPDF
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

app = FastAPI(title="TransLingua PDF Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Modeller ──────────────────────────────────────────────────────────────────

class TextBlock(BaseModel):
    text: str
    x: float        # sol kenar (0-1)
    y: float        # üst kenar (0-1)
    w: float        # genişlik (0-1)
    h: float        # yükseklik (0-1)
    fontSize: float # pt cinsinden
    fontName: str = ""
    bold: bool = False


class PageData(BaseModel):
    pageNum: int
    pageWidthPts: float
    pageHeightPts: float
    blocks: list[TextBlock]


class ExtractResponse(BaseModel):
    pages: list[PageData]
    totalPages: int


class TranslatedBlock(BaseModel):
    x: float; y: float; w: float; h: float
    fontSize: float; translated: str; original: str = ""


# ── Yardımcı: PDF baytlarından döküman aç ────────────────────────────────────

def open_pdf(data: bytes) -> fitz.Document:
    return fitz.open(stream=data, filetype="pdf")


# ── 1) Metin koordinatı çıkarma ──────────────────────────────────────────────

@app.post("/extract", response_model=ExtractResponse)
async def extract_pdf(file: UploadFile = File(...)):
    """
    PDF'den tüm metin bloklarını kesin koordinatlar + font bilgisiyle döndürür.
    Koordinatlar 0-1 arası oran (PyMuPDF'in pt koordinatları normalize edilir).
    """
    data = await file.read()
    doc = open_pdf(data)

    pages: list[PageData] = []

    for page_idx in range(doc.page_count):
        page: fitz.Page = doc[page_idx]
        pw = page.rect.width
        ph = page.rect.height

        # get_text("dict") → blok → satır → span hiyerarşisi
        text_dict = page.get_text(
            "dict",
            flags=fitz.TEXT_PRESERVE_WHITESPACE | fitz.TEXT_MEDIABOX_CLIP,
        )

        blocks: list[TextBlock] = []

        for blk in text_dict.get("blocks", []):
            if blk.get("type") != 0:
                continue  # 0 = metin bloğu, 1 = resim — resimleri atla

            for line in blk.get("lines", []):
                spans = line.get("spans", [])
                if not spans:
                    continue

                # Satırdaki tüm span'leri birleştir
                text = " ".join(s["text"].strip() for s in spans if s["text"].strip())
                if not text:
                    continue

                # Tüm span'leri kapsayan bounding box
                x0 = min(s["bbox"][0] for s in spans)
                y0 = min(s["bbox"][1] for s in spans)
                x1 = max(s["bbox"][2] for s in spans)
                y1 = max(s["bbox"][3] for s in spans)

                # İlk span'den font bilgisi al
                first_span = spans[0]
                fs = float(first_span.get("size", 10))
                font_name = first_span.get("font", "")
                flags = int(first_span.get("flags", 0))
                is_bold = bool(flags & 2**4)  # bit 4 = bold

                blocks.append(TextBlock(
                    text=text,
                    x=max(0.0, x0 / pw),
                    y=max(0.0, y0 / ph),
                    w=min(1.0, (x1 - x0) / pw),
                    h=min(1.0, (y1 - y0) / ph),
                    fontSize=fs,
                    fontName=font_name,
                    bold=is_bold,
                ))

        pages.append(PageData(
            pageNum=page_idx + 1,
            pageWidthPts=pw,
            pageHeightPts=ph,
            blocks=blocks,
        ))

    doc.close()
    return ExtractResponse(pages=pages, totalPages=len(pages))


# ── 2) Sayfa görüntüsü render ─────────────────────────────────────────────────

@app.post("/render-page")
async def render_page(
    file: UploadFile = File(...),
    page_num: int = Form(1),
    scale: float = Form(1.5),
):
    """
    Belirtilen sayfayı JPEG base64 data URL olarak döndürür.
    PDF.js yerine doğrudan PyMuPDF render → piksel mükemmelliği.
    """
    data = await file.read()
    doc = open_pdf(data)

    if page_num < 1 or page_num > doc.page_count:
        raise HTTPException(400, f"Geçersiz sayfa numarası: {page_num} (toplam: {doc.page_count})")

    page: fitz.Page = doc[page_num - 1]
    mat = fitz.Matrix(scale, scale)
    pix: fitz.Pixmap = page.get_pixmap(matrix=mat, alpha=False)

    img_bytes = pix.tobytes("jpeg", jpg_quality=88)
    b64 = base64.b64encode(img_bytes).decode()

    doc.close()
    return {
        "imageDataURL": f"data:image/jpeg;base64,{b64}",
        "width": pix.width,
        "height": pix.height,
    }


# ── 3) Çevrilmiş metni PDF'e yaz (çıktı: yeni PDF) ──────────────────────────

@app.post("/write-pdf")
async def write_pdf(
    file: UploadFile = File(...),
    pages_json: str = Form(...),
):
    """
    Her sayfa için çevrilmiş blokları PDF'e doğrudan yazar.
    Orijinal metin alanının üzerine beyaz dikdörtgen çizer, ardından çeviriyi ekler.

    pages_json formatı:
    [
      [{"x":0.1,"y":0.2,"w":0.5,"h":0.03,"fontSize":11,"translated":"Türkçe metin","original":"Original"}],
      ...
    ]
    """
    data = await file.read()
    try:
        pages_data: list[list[dict]] = json.loads(pages_json)
    except json.JSONDecodeError as e:
        raise HTTPException(400, f"Geçersiz JSON: {e}")

    doc = open_pdf(data)

    for page_idx, page_blocks in enumerate(pages_data):
        if page_idx >= doc.page_count:
            break

        page: fitz.Page = doc[page_idx]
        pw = page.rect.width
        ph = page.rect.height

        for blk in page_blocks:
            x = float(blk.get("x", 0)) * pw
            y = float(blk.get("y", 0)) * ph
            w = float(blk.get("w", 0)) * pw
            h = float(blk.get("h", 0)) * ph
            fs = float(blk.get("fontSize", 10))
            text = str(blk.get("translated", ""))

            if not text.strip() or w <= 0 or h <= 0:
                continue

            rect = fitz.Rect(x, y, x + w, y + h)

            # Orijinal metnin üzerine beyaz kap
            page.draw_rect(rect, color=(1, 1, 1), fill=(1, 1, 1), overlay=True)

            # Çevrilmiş metni ekle — font boyutunu kutuya sığacak şekilde küçült
            actual_fs = fs
            while actual_fs > 4:
                rc = page.insert_textbox(
                    rect,
                    text,
                    fontsize=actual_fs,
                    color=(0, 0, 0),
                    align=0,  # sola hizalı
                )
                if rc >= 0:
                    break  # sığdı
                actual_fs -= 0.5  # sığmadı → küçült

    pdf_bytes = doc.tobytes(garbage=4, deflate=True)
    doc.close()

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=translated.pdf"},
    )


# ── Sağlık kontrolü ──────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "pymupdf": fitz.version[0]}
