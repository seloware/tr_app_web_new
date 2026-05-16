/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PDFOverlayViewer — Önceden hesaplanmış çeviri overlay'ini gösterir.
 *
 * Mod 1 (varsayılan): overlayData props ile gelir → ANINDA gösterim, çeviri yapılmaz
 * Mod 2 (eski belgeler): overlayData yoksa "Üret" butonu gösterir, onProgress ile bildirir
 *
 * Görünüm:
 *  - PDF.js ile sayfa render edilir (orijinal grafik/şekil korunur)
 *  - Çeviri blokları HTML overlay olarak yerleştirilir
 *  - Zoom + sayfa navigasyon + orijinal/çeviri toggle + indir
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft, ChevronRight, X, Eye, EyeOff, Loader,
  ZoomIn, ZoomOut, Download, Sparkles, AlertCircle,
} from 'lucide-react';
import { loadPDFFromURL, renderPageToDataURL, type PDFProxy } from '../lib/pdfRenderer';
import { buildOverlayFromPDF } from '../lib/pdfOverlayBuilder';
import { exportOverlayToPDF, downloadBlob } from '../lib/pdfOverlayExporter';
import type { OverlayData } from '../types';
import styles from '../styles/components/overlayViewer.module.css';

export interface PDFOverlayViewerProps {
  pdfUrl: string;
  documentName?: string;
  sourceLang: string;
  overlayData?: OverlayData;
  /** Yeni üretilen overlay verisi kalıcı kayıt için döner */
  onOverlayGenerated?: (data: OverlayData) => Promise<void> | void;
  onClose: () => void;
}

export default function PDFOverlayViewer({
  pdfUrl,
  documentName = 'Belge',
  sourceLang,
  overlayData,
  onOverlayGenerated,
  onClose,
}: PDFOverlayViewerProps) {
  const [pdfProxy, setPdfProxy] = useState<PDFProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageImages, setPageImages] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [showTranslation, setShowTranslation] = useState(true);
  const [scale, setScale] = useState(1);

  // Overlay generation state (eski belgeler için)
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState<{ current: number; total: number; eta?: number; message: string }>({ current: 0, total: 0, message: '' });
  const [localOverlay, setLocalOverlay] = useState<OverlayData | undefined>(overlayData);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ── PDF yükle ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');

    loadPDFFromURL(pdfUrl)
      .then(proxy => {
        if (cancelled) return;
        setPdfProxy(proxy);
      })
      .catch(e => {
        if (!cancelled) setLoadError(e.message || 'PDF yüklenemedi');
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [pdfUrl]);

  // ── Sayfa görüntüsünü cache'le (sadece görüntüleme için, çeviri yok) ──────
  const renderCurrentPage = useCallback(async (pageNum: number) => {
    if (!pdfProxy || pageImages[pageNum]) return;
    try {
      const dataURL = await renderPageToDataURL(pdfProxy, pageNum, 1.6);
      setPageImages(prev => ({ ...prev, [pageNum]: dataURL }));
    } catch (e: any) {
      console.warn('Sayfa render hatası:', e);
    }
  }, [pdfProxy, pageImages]);

  useEffect(() => {
    if (pdfProxy && !pageImages[currentPage]) {
      renderCurrentPage(currentPage);
    }
  }, [currentPage, pdfProxy, pageImages, renderCurrentPage]);

  // İlk sayfa için
  useEffect(() => {
    if (pdfProxy && !pageImages[1]) {
      renderCurrentPage(1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfProxy]);

  // ── Klavye navigasyonu ───────────────────────────────────────────────────
  const totalPages = localOverlay?.pages.length ?? pdfProxy?.numPages ?? 0;

  const goToPage = useCallback((n: number) => {
    if (n < 1 || n > totalPages) return;
    setCurrentPage(n);
  }, [totalPages]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') goToPage(currentPage + 1);
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') goToPage(currentPage - 1);
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentPage, goToPage, onClose]);

  // ── Container genişliği (font ölçeği için) ───────────────────────────────
  const [containerW, setContainerW] = useState(760);
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => {
      setContainerW(containerRef.current?.clientWidth ?? 760);
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // ── Eski belgeler için: overlay üret ─────────────────────────────────────
  const generateOverlay = async () => {
    if (!pdfUrl) return;
    setGenerating(true);
    abortRef.current = new AbortController();
    try {
      const { pages } = await buildOverlayFromPDF(pdfUrl, {
        sourceLang,
        targetLang: 'tr',
        signal: abortRef.current.signal,
        onProgress: (info) => {
          setGenProgress({
            current: info.current,
            total: info.total,
            eta: info.estimatedSecondsLeft,
            message: info.message,
          });
        },
      });
      const data: OverlayData = {
        version: 1,
        sourceLang,
        targetLang: 'tr',
        pages,
      };
      setLocalOverlay(data);
      if (onOverlayGenerated) await onOverlayGenerated(data);
    } catch (e: any) {
      if (e?.message !== 'İptal edildi') {
        setLoadError(e.message || 'Overlay üretilemedi');
      }
    } finally {
      setGenerating(false);
    }
  };

  // ── PDF olarak indir ─────────────────────────────────────────────────────
  const handleExport = async () => {
    if (!localOverlay || !pdfProxy) return;
    setExporting(true);
    setExportProgress({ current: 0, total: localOverlay.pages.length });
    try {
      const blob = await exportOverlayToPDF(pdfProxy, localOverlay.pages, {
        onProgress: (current, total) => setExportProgress({ current, total }),
      });
      const safeName = documentName.replace(/\.pdf$/i, '').replace(/[^\w\d-_]+/g, '_');
      downloadBlob(blob, `${safeName}_ceviri.pdf`);
    } catch (e: any) {
      alert('İndirme hatası: ' + (e.message || 'Bilinmeyen hata'));
    } finally {
      setExporting(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────
  const currentOverlayPage = localOverlay?.pages.find(p => p.pageNum === currentPage);
  const { pageWidthPts = 595, pageHeightPts = 842 } = currentOverlayPage ?? {};
  const aspectRatio = pageHeightPts / pageWidthPts;
  const pxScale = (containerW / pageWidthPts) * scale;

  return (
    <div className={styles.backdrop} onClick={e => { if (e.target === e.currentTarget && !generating && !exporting) onClose(); }}>
      <motion.div
        className={styles.modal}
        initial={{ opacity: 0, scale: 0.96, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 20 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* ── Toolbar ───────────────────────────────────────────────── */}
        <div className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            <button
              className={`${styles.toolBtn} ${showTranslation ? styles.toolBtnActive : ''}`}
              onClick={() => setShowTranslation(v => !v)}
              disabled={!localOverlay}
              title={showTranslation ? 'Orijinali göster' : 'Çeviriyi göster'}
            >
              {showTranslation ? <><Eye size={14} /> <span>Çeviri</span></> : <><EyeOff size={14} /> <span>Orijinal</span></>}
            </button>

            <button className={styles.iconBtn} onClick={() => setScale(s => Math.max(0.5, s - 0.15))} title="Küçült">
              <ZoomOut size={14} />
            </button>
            <span className={styles.zoomLabel}>{Math.round(scale * 100)}%</span>
            <button className={styles.iconBtn} onClick={() => setScale(s => Math.min(2.5, s + 0.15))} title="Büyüt">
              <ZoomIn size={14} />
            </button>

            {localOverlay && (
              <button
                className={`${styles.toolBtn} ${styles.toolBtnExport}`}
                onClick={handleExport}
                disabled={exporting}
                title="Çeviri PDF olarak indir"
              >
                {exporting
                  ? <><Loader size={13} className={styles.spin} /> {exportProgress.current}/{exportProgress.total}</>
                  : <><Download size={14} /> <span>PDF İndir</span></>
                }
              </button>
            )}
          </div>

          <div className={styles.toolbarCenter}>
            <button className={styles.navBtn} onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1}>
              <ChevronLeft size={16} />
            </button>
            <span className={styles.pageInfo}>
              Sayfa <strong>{currentPage}</strong> / {totalPages}
            </span>
            <button className={styles.navBtn} onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= totalPages}>
              <ChevronRight size={16} />
            </button>
          </div>

          <div className={styles.toolbarRight}>
            <button className={styles.closeBtn} onClick={onClose} title="Kapat" disabled={generating || exporting}>
              <X size={16} />
            </button>
          </div>
        </div>

        {/* ── Sayfa içeriği ──────────────────────────────────────────── */}
        <div className={styles.pageArea}>
          {loading && (
            <div className={styles.centeredOverlay}>
              <Loader size={28} className={styles.spin} />
              <span>PDF yükleniyor…</span>
            </div>
          )}

          {loadError && (
            <div className={styles.centeredOverlay}>
              <AlertCircle size={24} color="var(--color-error)" />
              <p className={styles.errorText}>{loadError}</p>
            </div>
          )}

          {/* Overlay yoksa: ilk üretim CTA */}
          {!loading && !loadError && !localOverlay && !generating && (
            <div className={styles.generatePanel}>
              <Sparkles size={32} className={styles.generateIcon} />
              <h3 className={styles.generateTitle}>PDF Üzerinde Çeviri Henüz Oluşturulmadı</h3>
              <p className={styles.generateDesc}>
                Bu belge eski sistemle çevrildi. PDF görünümü için bir kez çeviri oluşturun —
                sonra anında açılır, tekrar beklemezsiniz. Grafikler, formüller ve görseller orijinal kalır;
                sadece metin Türkçeye çevrilir.
              </p>
              <button className={styles.generateBtn} onClick={generateOverlay}>
                <Sparkles size={15} /> PDF Çevirisini Oluştur
              </button>
            </div>
          )}

          {/* Generating: progress */}
          {generating && (
            <div className={styles.generatePanel}>
              <Loader size={32} className={`${styles.generateIcon} ${styles.spin}`} />
              <h3 className={styles.generateTitle}>Çeviri Üretiliyor</h3>
              <p className={styles.generateDesc}>{genProgress.message}</p>
              <div className={styles.progressBar}>
                <div
                  className={styles.progressBarFill}
                  style={{ width: `${genProgress.total ? (genProgress.current / genProgress.total) * 100 : 0}%` }}
                />
              </div>
              <p className={styles.progressLabel}>
                {genProgress.current} / {genProgress.total} sayfa
                {genProgress.eta != null && genProgress.eta > 0 && ` • ~${genProgress.eta} sn kaldı`}
              </p>
              <button className={styles.cancelBtn} onClick={() => abortRef.current?.abort()}>
                İptal
              </button>
            </div>
          )}

          {/* Overlay var: göster */}
          {!loading && !loadError && localOverlay && (
            <div
              className={styles.pageWrapper}
              style={{ transform: `scale(${scale})`, transformOrigin: 'top center' }}
            >
              <div
                ref={containerRef}
                className={styles.pageContainer}
                style={{ paddingBottom: `${aspectRatio * 100}%` }}
              >
                {pageImages[currentPage] && (
                  <img
                    src={pageImages[currentPage]}
                    alt={`Sayfa ${currentPage}`}
                    className={styles.pageImg}
                    draggable={false}
                  />
                )}

                <AnimatePresence>
                  {showTranslation && currentOverlayPage?.blocks.map((b, i) => (
                    <motion.div
                      key={i}
                      className={`${styles.textBlock} ${b.visual ? styles.textBlockVisual : ''}`}
                      style={{
                        left: `${b.x * 100}%`,
                        top: `${b.y * 100}%`,
                        width: `${b.w * 100}%`,
                        minHeight: `${b.h * 100}%`,
                        fontSize: `${b.fontSize * pxScale * 0.92}px`,
                        lineHeight: 1.22,
                      }}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.18 }}
                      title={b.original}
                    >
                      {b.translated}
                    </motion.div>
                  ))}
                </AnimatePresence>

                {!pageImages[currentPage] && (
                  <div className={styles.centered}>
                    <Loader size={22} className={styles.spin} />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Alt bilgi ─────────────────────────────────────────────── */}
        <div className={styles.footer}>
          <span className={styles.footerNote}>
            Grafikler, formüller ve görseller orijinal kalır. Sadece metin çevrilir.
          </span>
          {currentOverlayPage && (
            <span className={styles.blockCount}>
              {currentOverlayPage.blocks.length} blok
              {currentOverlayPage.blocks.some(b => b.visual) && ' (görsel içi dahil)'}
            </span>
          )}
        </div>
      </motion.div>
    </div>
  );
}
