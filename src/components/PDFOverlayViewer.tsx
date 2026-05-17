/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PDFOverlayViewer — Profesyonel çeviri görüntüleyici
 *
 * Backend PyMuPDF ile çevrilmiş PDF oluşturur → PDF.js ile doğrudan render eder.
 * HTML overlay / sarı kutu yok — metin PDF'e fiziksel olarak yazılır.
 *
 * Mod 1: overlayData mevcut → otomatik translated PDF build + göster
 * Mod 2: overlayData yok (eski belge) → "Oluştur" → build + göster
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft, ChevronRight, X, Eye, EyeOff, Loader,
  ZoomIn, ZoomOut, Download, Sparkles, AlertCircle, CheckCircle2,
} from 'lucide-react';
import { loadPDFFromURL, renderPageToDataURL, type PDFProxy } from '../lib/pdfRenderer';
import { translatePDF } from '../lib/pdfTranslator';
import { buildTranslatedPDF, downloadBytes } from '../lib/pdfWriter';
import type { OverlayData } from '../types';
import styles from '../styles/components/overlayViewer.module.css';

export interface PDFOverlayViewerProps {
  pdfUrl: string;
  documentName?: string;
  sourceLang: string;
  overlayData?: OverlayData;
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
  // ── Orijinal PDF ────────────────────────────────────────────────────────
  const [pdfProxy, setPdfProxy] = useState<PDFProxy | null>(null);
  const [pageImages, setPageImages] = useState<Record<number, string>>({});

  // ── Çevrilmiş PDF ───────────────────────────────────────────────────────
  const [translatedProxy, setTranslatedProxy] = useState<PDFProxy | null>(null);
  const [translatedImages, setTranslatedImages] = useState<Record<number, string>>({});
  const [translatedBytes, setTranslatedBytes] = useState<Uint8Array | null>(null);
  const [building, setBuilding] = useState(false);
  const [buildDone, setBuildDone] = useState(false);
  const [buildError, setBuildError] = useState('');

  // ── UI ──────────────────────────────────────────────────────────────────
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [showTranslation, setShowTranslation] = useState(true);
  const [scale, setScale] = useState(1);

  // ── Overlay üretimi (eski belgeler) ────────────────────────────────────
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState<{ current: number; total: number; eta?: number; message: string }>({ current: 0, total: 0, message: '' });
  const [localOverlay, setLocalOverlay] = useState<OverlayData | undefined>(overlayData);
  const [exporting, setExporting] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const translatedBlobRef = useRef<string | null>(null);

  // ── Orijinal PDF yükle ─────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    loadPDFFromURL(pdfUrl)
      .then(p => { if (!cancelled) setPdfProxy(p); })
      .catch(e => { if (!cancelled) setLoadError(e.message || 'PDF yüklenemedi'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [pdfUrl]);

  // ── Overlay hazır olunca translated PDF oluştur ────────────────────────
  useEffect(() => {
    if (!localOverlay || !pdfUrl) return;
    let cancelled = false;
    setBuilding(true);
    setBuildDone(false);
    setBuildError('');

    (async () => {
      try {
        const res = await fetch(pdfUrl);
        const arrayBuffer = await res.arrayBuffer();
        const bytes = await buildTranslatedPDF({
          originalPDF: arrayBuffer,
          pages: localOverlay.pages,
        });
        if (cancelled) return;
        setTranslatedBytes(bytes);

        const blob = new Blob([bytes], { type: 'application/pdf' });
        const blobUrl = URL.createObjectURL(blob);
        if (translatedBlobRef.current) URL.revokeObjectURL(translatedBlobRef.current);
        translatedBlobRef.current = blobUrl;

        const proxy = await loadPDFFromURL(blobUrl);
        if (!cancelled) {
          setTranslatedProxy(proxy);
          setBuildDone(true);
        }
      } catch (e: any) {
        if (!cancelled) setBuildError(e.message || 'Çeviri PDF oluşturulamadı');
      } finally {
        if (!cancelled) setBuilding(false);
      }
    })();

    return () => { cancelled = true; };
  }, [localOverlay, pdfUrl]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => { if (translatedBlobRef.current) URL.revokeObjectURL(translatedBlobRef.current); };
  }, []);

  // ── Sayfa render ───────────────────────────────────────────────────────
  const renderOriginalPage = useCallback(async (n: number) => {
    if (!pdfProxy || pageImages[n]) return;
    try {
      const url = await renderPageToDataURL(pdfProxy, n, 1.8);
      setPageImages(p => ({ ...p, [n]: url }));
    } catch { /* ignore */ }
  }, [pdfProxy, pageImages]);

  const renderTranslatedPage = useCallback(async (n: number) => {
    if (!translatedProxy || translatedImages[n]) return;
    try {
      const url = await renderPageToDataURL(translatedProxy, n, 1.8);
      setTranslatedImages(p => ({ ...p, [n]: url }));
    } catch { /* ignore */ }
  }, [translatedProxy, translatedImages]);

  // Orijinal sayfa
  useEffect(() => {
    if (pdfProxy && !pageImages[currentPage]) renderOriginalPage(currentPage);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, pdfProxy]);

  // İlk sayfa preload
  useEffect(() => {
    if (pdfProxy && !pageImages[1]) renderOriginalPage(1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfProxy]);

  // Çevrilmiş sayfa
  useEffect(() => {
    if (translatedProxy && showTranslation && !translatedImages[currentPage]) {
      renderTranslatedPage(currentPage);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, translatedProxy, showTranslation]);

  // Translated proxy hazır olunca mevcut sayfayı render et
  useEffect(() => {
    if (translatedProxy) renderTranslatedPage(currentPage);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translatedProxy]);

  // ── Navigasyon ─────────────────────────────────────────────────────────
  const totalPages = pdfProxy?.numPages ?? 0;

  const goToPage = useCallback((n: number) => {
    if (n < 1 || n > totalPages) return;
    setCurrentPage(n);
  }, [totalPages]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') goToPage(currentPage + 1);
      if (e.key === 'ArrowLeft'  || e.key === 'PageUp')   goToPage(currentPage - 1);
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentPage, goToPage, onClose]);

  // ── Overlay üretimi (eski belgeler) ────────────────────────────────────
  const generateOverlay = async () => {
    if (!pdfUrl) return;
    setGenerating(true);
    abortRef.current = new AbortController();
    try {
      const { pages } = await translatePDF(pdfUrl, {
        sourceLang,
        targetLang: 'tr',
        signal: abortRef.current.signal,
        onProgress: (info) => setGenProgress({
          current: info.current,
          total: info.total,
          eta: info.estimatedSecondsLeft,
          message: info.message,
        }),
      });
      const data: OverlayData = { version: 1, sourceLang, targetLang: 'tr', pages };
      setLocalOverlay(data);
      if (onOverlayGenerated) await onOverlayGenerated(data);
    } catch (e: any) {
      if (e?.message !== 'İptal edildi') setLoadError(e.message || 'Çeviri üretilemedi');
    } finally {
      setGenerating(false);
    }
  };

  // ── İndir ──────────────────────────────────────────────────────────────
  const handleExport = async () => {
    if (!localOverlay) return;
    const safeName = documentName.replace(/\.pdf$/i, '').replace(/[^\w\d-_]+/g, '_');
    if (translatedBytes) {
      downloadBytes(translatedBytes, `${safeName}_TR.pdf`);
      return;
    }
    setExporting(true);
    try {
      const res = await fetch(pdfUrl);
      const arrayBuffer = await res.arrayBuffer();
      const bytes = await buildTranslatedPDF({ originalPDF: arrayBuffer, pages: localOverlay.pages });
      downloadBytes(bytes, `${safeName}_TR.pdf`);
    } catch (e: any) {
      alert('İndirme hatası: ' + (e.message || 'Bilinmeyen hata'));
    } finally {
      setExporting(false);
    }
  };

  // ── Türetilmiş değerler ────────────────────────────────────────────────
  const showingTranslated = showTranslation && !!translatedProxy;
  const currentImage = showingTranslated
    ? (translatedImages[currentPage] ?? pageImages[currentPage])
    : pageImages[currentPage];

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div
      className={styles.backdrop}
      onClick={e => { if (e.target === e.currentTarget && !generating) onClose(); }}
    >
      <motion.div
        className={styles.modal}
        initial={{ opacity: 0, scale: 0.96, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 20 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* ── Toolbar ─────────────────────────────────────────────── */}
        <div className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            {localOverlay && (
              <button
                className={`${styles.toolBtn} ${showTranslation ? styles.toolBtnActive : ''}`}
                onClick={() => setShowTranslation(v => !v)}
                title={showTranslation ? 'Orijinali göster' : 'Çeviriyi göster'}
              >
                {showTranslation
                  ? <><Eye size={14} /> <span>Çeviri</span></>
                  : <><EyeOff size={14} /> <span>Orijinal</span></>
                }
                {building && showTranslation && (
                  <Loader size={11} className={styles.spin} style={{ marginLeft: 3, opacity: 0.7 }} />
                )}
                {buildDone && showTranslation && (
                  <CheckCircle2 size={11} style={{ marginLeft: 3, color: 'var(--color-success)' }} />
                )}
              </button>
            )}

            <button className={styles.iconBtn} onClick={() => setScale(s => Math.max(0.5, s - 0.15))} title="Küçült">
              <ZoomOut size={14} />
            </button>
            <span className={styles.zoomLabel}>{Math.round(scale * 100)}%</span>
            <button className={styles.iconBtn} onClick={() => setScale(s => Math.min(3, s + 0.15))} title="Büyüt">
              <ZoomIn size={14} />
            </button>

            {localOverlay && (
              <button
                className={`${styles.toolBtn} ${styles.toolBtnExport}`}
                onClick={handleExport}
                disabled={exporting || (building && !translatedBytes)}
                title="Çeviri PDF olarak indir"
              >
                {exporting
                  ? <><Loader size={13} className={styles.spin} /> İndiriliyor…</>
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
              Sayfa <strong>{currentPage}</strong> / {totalPages || '…'}
            </span>
            <button className={styles.navBtn} onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= totalPages}>
              <ChevronRight size={16} />
            </button>
          </div>

          <div className={styles.toolbarRight}>
            <button className={styles.closeBtn} onClick={onClose} title="Kapat" disabled={generating}>
              <X size={16} />
            </button>
          </div>
        </div>

        {/* ── Sayfa alanı ──────────────────────────────────────────── */}
        <div className={styles.pageArea}>

          {/* İlk yükleme */}
          {loading && (
            <div className={styles.centeredOverlay}>
              <Loader size={28} className={styles.spin} />
              <span>PDF yükleniyor…</span>
            </div>
          )}

          {/* Hata */}
          {loadError && (
            <div className={styles.centeredOverlay}>
              <AlertCircle size={24} color="var(--color-error)" />
              <p className={styles.errorText}>{loadError}</p>
            </div>
          )}

          {/* Eski belge: overlay yok, üret */}
          {!loading && !loadError && !localOverlay && !generating && (
            <div className={styles.generatePanel}>
              <Sparkles size={32} className={styles.generateIcon} />
              <h3 className={styles.generateTitle}>PDF Çevirisi Henüz Oluşturulmadı</h3>
              <p className={styles.generateDesc}>
                Bu belge eski sistemle çevrildi. Bir kez oluşturun — kalıcı olarak kaydedilir,
                sonra anında açılır. Grafikler ve görseller orijinal kalır.
              </p>
              <button className={styles.generateBtn} onClick={generateOverlay}>
                <Sparkles size={15} /> PDF Çevirisini Oluştur
              </button>
            </div>
          )}

          {/* Overlay üretim ilerlemesi */}
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
              <button className={styles.cancelBtn} onClick={() => abortRef.current?.abort()}>İptal</button>
            </div>
          )}

          {/* Sayfa görüntüsü */}
          {!loading && !loadError && pdfProxy && !generating && (
            <div
              className={styles.pageWrapper}
              style={{ transform: `scale(${scale})`, transformOrigin: 'top center' }}
            >
              <div className={styles.pageContainer}>
                <AnimatePresence mode="wait">
                  {currentImage ? (
                    <motion.img
                      key={`${showingTranslated ? 'tr' : 'orig'}-p${currentPage}`}
                      src={currentImage}
                      alt={`Sayfa ${currentPage}`}
                      className={styles.pageImg}
                      draggable={false}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.18 }}
                    />
                  ) : (
                    <motion.div
                      key="page-loading"
                      className={styles.pageLoading}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                    >
                      <Loader size={22} className={styles.spin} />
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Çeviri oluşturuluyor rozeti */}
                {showTranslation && building && (
                  <div className={styles.buildingBadge}>
                    <Loader size={11} className={styles.spin} />
                    <span>Çeviri hazırlanıyor…</span>
                  </div>
                )}

                {/* Çeviri hazır rozeti (kısa süre görünür) */}
                <AnimatePresence>
                  {buildDone && showTranslation && !building && (
                    <motion.div
                      className={styles.readyBadge}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.3 }}
                    >
                      <CheckCircle2 size={11} />
                      <span>PyMuPDF ile çevrildi</span>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Build hatası */}
                {buildError && showTranslation && (
                  <div className={styles.errorBadge}>
                    <AlertCircle size={13} />
                    <span>{buildError}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Alt bilgi ────────────────────────────────────────────── */}
        <div className={styles.footer}>
          <span className={styles.footerNote}>
            {showingTranslated
              ? 'Metinler Türkçeye çevrildi — grafikler ve görseller orijinal kalır.'
              : 'Orijinal belge gösteriliyor.'
            }
          </span>
          {building && (
            <span className={styles.footerStatus}>
              <Loader size={11} className={styles.spin} /> Hazırlanıyor…
            </span>
          )}
          {buildDone && !building && (
            <span className={styles.footerStatus} style={{ color: 'var(--color-success)' }}>
              <CheckCircle2 size={11} /> Hazır
            </span>
          )}
        </div>
      </motion.div>
    </div>
  );
}
