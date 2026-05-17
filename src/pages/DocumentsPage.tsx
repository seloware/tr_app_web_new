/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * TransLingua — DocumentsPage (Dokümanlar Sayfası)
 *
 * Kullanıcının yüklediği ve çevirdiği tüm belgelerin listelendiği sayfa.
 * Her kart için durum, çeviri metnini görüntüleme ve silme işlemleri içerir.
 */
import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { FileText, MessageSquare, Trash2, FolderOpen, Eye, X, Languages, DownloadCloud, FileType, FileCode, Layers, Loader, BookOpen } from 'lucide-react';
import toast from 'react-hot-toast';
import { exportMarkdownToPDF, exportMarkdownToDOCX, exportMarkdownToTxt } from '../lib/exporters';
import { SPRING_TIGHT } from '../components/ui/motion';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { summarizeDocument } from '../lib/ai';
import { STATUS_LABELS } from '../lib/constants';
import type { Document, Translation } from '../types';
import styles from '../styles/components/documents.module.css';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import PDFOverlayViewer from '../components/PDFOverlayViewer';

/** Belge + varsa ilk çeviri bilgisi */
interface DocumentWithTranslation extends Document {
  translation?: Translation | null;
}

export default function DocumentsPage() {
  const { profile } = useAuth();
  const reduced = useReducedMotion();
  const [documents, setDocuments] = useState<DocumentWithTranslation[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<DocumentWithTranslation | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState<null | 'pdf' | 'docx' | 'txt'>(null);

  // PDF Overlay Viewer
  const [overlayDoc, setOverlayDoc] = useState<DocumentWithTranslation | null>(null);
  const [overlayUrl, setOverlayUrl] = useState('');
  const [overlayLoading, setOverlayLoading] = useState(false);

  // Özet modal
  const [summaryDoc, setSummaryDoc] = useState<DocumentWithTranslation | null>(null);
  const [summaryText, setSummaryText] = useState('');
  const [summaryLoading, setSummaryLoading] = useState(false);
  const summaryAbortRef = useRef<AbortController | null>(null);

  // Belgeleri ve çevirilerini birlikte çek
  useEffect(() => {
    if (!profile) return;

    const fetchDocuments = async () => {
      // Belgeler + her belgeye ait tamamlanan ilk çeviriyi join et
      const { data: docs } = await supabase
        .from('documents')
        .select(`
          *,
          translation:translations(*)
        `)
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false });

      if (docs) {
        // translations dizisinin ilk elemanını translation olarak ata
        const mapped = docs.map((d: DocumentWithTranslation & { translation: Translation[] }) => ({
          ...d,
          translation: Array.isArray(d.translation) ? d.translation[0] ?? null : d.translation,
        }));
        setDocuments(mapped as DocumentWithTranslation[]);
      }
    };

    fetchDocuments();
  }, [profile]);

  /** Belge durumuna göre renk sınıfı döndürür */
  const statusClass = (s: string) => {
    if (s === 'completed') return styles.statusCompleted;
    if (s === 'error') return styles.statusError;
    return styles.statusProcessing;
  };

  /** Belgeyi veritabanından ve listeden siler */
  const handleDelete = async (id: string) => {
    await supabase.from('documents').delete().eq('id', id);
    setDocuments(prev => prev.filter(d => d.id !== id));
    if (selectedDoc?.id === id) setSelectedDoc(null);
  };

  /** PDF Overlay Viewer'ı aç — Supabase Storage'dan imzalı URL al */
  const openOverlay = async (doc: DocumentWithTranslation) => {
    if (!doc.original_storage_path) {
      toast.error('Orijinal PDF bulunamadı.');
      return;
    }
    setOverlayLoading(true);
    try {
      const { data, error } = await supabase.storage
        .from('originals')
        .createSignedUrl(doc.original_storage_path, 3600);
      if (error || !data?.signedUrl) throw new Error('PDF URL alınamadı');
      setOverlayUrl(data.signedUrl);
      setOverlayDoc(doc);
    } catch (e: any) {
      toast.error(e.message || 'PDF açılamadı');
    } finally {
      setOverlayLoading(false);
    }
  };

  /** Özet oluştur */
  const openSummary = async (doc: DocumentWithTranslation) => {
    const text = doc.translation?.translated_text?.pages.join('\n\n');
    if (!text) { toast.error('Çeviri metni bulunamadı.'); return; }
    setSummaryDoc(doc);
    setSummaryText('');
    setSummaryLoading(true);
    summaryAbortRef.current = new AbortController();
    try {
      await summarizeDocument(
        text,
        summaryAbortRef.current.signal,
        (_delta, full) => setSummaryText(full),
      );
    } catch (e: any) {
      if (e?.name !== 'AbortError') toast.error(e.message || 'Özet oluşturulamadı');
    } finally {
      setSummaryLoading(false);
    }
  };

  /** Çeviriyi seçilen formatta indir */
  const downloadAs = async (format: 'pdf' | 'docx' | 'txt') => {
    if (!selectedDoc?.translation?.translated_text) return;
    const md = selectedDoc.translation.translated_text.pages.join('\n\n');
    const baseName = selectedDoc.original_name.replace(/\.pdf$/i, '') + '_ceviri';
    const subtitle = `Türkçe çeviri • ${new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}`;
    setExporting(format);
    try {
      if (format === 'pdf') {
        await exportMarkdownToPDF(md, { filename: `${baseName}.pdf`, title: selectedDoc.original_name, subtitle });
      } else if (format === 'docx') {
        await exportMarkdownToDOCX(md, { filename: `${baseName}.docx`, title: selectedDoc.original_name, subtitle });
      } else {
        exportMarkdownToTxt(md, `${baseName}.txt`);
      }
      toast.success(`${format.toUpperCase()} indirildi`);
    } catch (err) {
      console.error(err);
      toast.error('İndirme başarısız oldu');
    } finally {
      setExporting(null);
      setExportOpen(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Dokümanlarım</h1>
          <p className={styles.desc}>Yüklediğiniz ve çevirdiğiniz tüm belgeler burada.</p>
        </div>
        <motion.div
          whileHover={reduced ? undefined : { y: -2 }}
          whileTap={reduced ? undefined : { scale: 0.96 }}
          transition={SPRING_TIGHT}
        >
          <Link to="/translate" className={styles.newBtn}>
            + Yeni Çeviri
          </Link>
        </motion.div>
      </div>

      {/* Boş durum */}
      {documents.length === 0 ? (
        <div className={styles.empty}>
          <FolderOpen size={48} className={styles.emptyIcon} />
          <p className={styles.emptyTitle}>Henüz doküman yok</p>
          <p className={styles.emptyDesc}>
            İlk belgenizi çevirmek için{' '}
            <Link to="/translate" className={styles.emptyLink}>çeviri sayfasına</Link>{' '}
            gidin.
          </p>
        </div>
      ) : (
        <div className={styles.grid}>
          <AnimatePresence mode="popLayout">
            {documents.map((doc, i) => (
              <motion.div
                key={doc.id}
                layout
                className={styles.card}
                initial={{ opacity: 0, y: 20, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.22 } }}
                transition={{ delay: i * 0.05, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                whileHover={reduced ? undefined : { y: -4 }}
              >
                {/* Üst kısım: ikon + isim + durum */}
                <div className={styles.cardHeader}>
                  <motion.div
                    className={styles.cardIcon}
                    whileHover={reduced ? undefined : { rotate: -8, scale: 1.08 }}
                    transition={SPRING_TIGHT}
                  >
                    <FileText size={20} />
                  </motion.div>
                  <div className={styles.cardInfo}>
                    <div className={styles.cardName} title={doc.original_name}>{doc.original_name}</div>
                    <div className={styles.cardMeta}>
                      {doc.page_count || '?'} sayfa &bull; {(doc.file_size_bytes / 1024 / 1024).toFixed(1)} MB
                    </div>
                  </div>
                  <span className={`${styles.status} ${statusClass(doc.status)}`}>
                    {STATUS_LABELS[doc.status] || doc.status}
                  </span>
                </div>

                {/* Tarih */}
                <div className={styles.cardDate}>
                  {new Date(doc.created_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}
                </div>

                {/* Çeviri dil satırı */}
                {doc.translation && (
                  <div className={styles.translationRow}>
                    <Languages size={13} />
                    <span>Türkçe çeviri mevcut</span>
                  </div>
                )}

                {/* İşlem butonları */}
                <div className={styles.cardActions}>
                  {/* PDF üstüne yaz — ana özellik, tam genişlik */}
                  {doc.status === 'completed' && doc.original_storage_path && (
                    <motion.button
                      className={styles.btnOverlay}
                      onClick={() => openOverlay(doc)}
                      disabled={overlayLoading}
                      whileHover={reduced ? undefined : { y: -1 }}
                      whileTap={reduced ? undefined : { scale: 0.95 }}
                      transition={SPRING_TIGHT}
                      title="Çeviriyi orijinal PDF üzerinde göster"
                    >
                      {overlayLoading && overlayDoc?.id === doc.id
                        ? <Loader size={13} style={{ animation: 'spin 0.8s linear infinite' }} />
                        : <Layers size={13} />
                      }
                      PDF Görünümü
                    </motion.button>
                  )}

                  {/* İkincil butonlar — tek satırda */}
                  <div className={styles.cardActionsRow}>
                    {doc.translation?.translated_text && (
                      <motion.button
                        className={styles.btnSummary}
                        onClick={() => openSummary(doc)}
                        whileHover={reduced ? undefined : { y: -1 }}
                        whileTap={reduced ? undefined : { scale: 0.95 }}
                        transition={SPRING_TIGHT}
                        title="Yapay zeka ile belge özeti oluştur"
                      >
                        <BookOpen size={13} /> Özetle
                      </motion.button>
                    )}

                    {doc.translation?.translated_text && (
                      <motion.button
                        className={styles.btnView}
                        onClick={() => setSelectedDoc(doc)}
                        whileHover={reduced ? undefined : { y: -1 }}
                        whileTap={reduced ? undefined : { scale: 0.95 }}
                        transition={SPRING_TIGHT}
                      >
                        <Eye size={14} /> Metin
                      </motion.button>
                    )}

                    <motion.div
                      whileHover={reduced ? undefined : { y: -1 }}
                      whileTap={reduced ? undefined : { scale: 0.95 }}
                      transition={SPRING_TIGHT}
                      style={{ display: 'inline-flex', flex: 1 }}
                    >
                      <Link to="/chat" state={{ documentId: doc.id }} className={styles.btnChat}>
                        <MessageSquare size={14} /> AI Sor
                      </Link>
                    </motion.div>

                    <motion.button
                      className={styles.btnDelete}
                      onClick={() => handleDelete(doc.id)}
                      whileHover={reduced ? undefined : { y: -1 }}
                      whileTap={reduced ? undefined : { scale: 0.95 }}
                      transition={SPRING_TIGHT}
                    >
                      <Trash2 size={14} /> Sil
                    </motion.button>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Çeviri Görüntüleme Modal */}
      <AnimatePresence>
        {selectedDoc && (
          <motion.div
            className={styles.modalOverlay}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedDoc(null)}
          >
            <motion.div
              className={styles.modal}
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
            >
              <div className={styles.modalHeader}>
                <div>
                  <h2 className={styles.modalTitle}>{selectedDoc.original_name}</h2>
                  <p className={styles.modalSub}>Türkçe Çeviri</p>
                </div>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', position: 'relative' }}>
                  <motion.button
                    className={styles.btnView}
                    style={{ background: 'var(--color-success-bg)', color: 'var(--color-success)', border: 'none', padding: '8px 12px', borderRadius: 'var(--radius-sm)', cursor: exporting ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 500 }}
                    onClick={() => setExportOpen(o => !o)}
                    disabled={!!exporting}
                    whileHover={reduced || exporting ? undefined : { y: -1 }}
                    whileTap={reduced || exporting ? undefined : { scale: 0.96 }}
                    transition={SPRING_TIGHT}
                  >
                    <DownloadCloud size={16} />
                    {exporting ? `${exporting.toUpperCase()} hazırlanıyor…` : 'İndir'}
                  </motion.button>
                  <AnimatePresence>
                    {exportOpen && !exporting && (
                      <motion.div
                        initial={{ opacity: 0, y: -8, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -8, scale: 0.96 }}
                        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                        style={{
                          position: 'absolute', top: 'calc(100% + 6px)', right: 60,
                          background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                          borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)',
                          padding: 6, minWidth: 180, zIndex: 5,
                        }}
                      >
                        {([
                          { fmt: 'pdf' as const, label: 'PDF (.pdf)', icon: <FileText size={14} /> },
                          { fmt: 'docx' as const, label: 'Word (.docx)', icon: <FileType size={14} /> },
                          { fmt: 'txt' as const, label: 'Metin (.txt)', icon: <FileCode size={14} /> },
                        ]).map(({ fmt, label, icon }) => (
                          <button
                            key={fmt}
                            onClick={() => downloadAs(fmt)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 8,
                              width: '100%', padding: '8px 10px', background: 'transparent',
                              border: 'none', borderRadius: 8, cursor: 'pointer',
                              fontSize: 13, color: 'var(--color-text-primary)', textAlign: 'left',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg-alt)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                          >
                            {icon} {label}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <button className={styles.modalClose} onClick={() => setSelectedDoc(null)}>
                    <X size={20} />
                  </button>
                </div>
              </div>
              <div className={`${styles.modalBody} markdown-body`}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm as any, remarkMath as any]}
                  rehypePlugins={[rehypeKatex as any]}
                >
                  {selectedDoc.translation?.translated_text?.pages.join('\n\n') || ''}
                </ReactMarkdown>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── PDF Overlay Viewer ─────────────────────────────────── */}
      <AnimatePresence>
        {overlayDoc && overlayUrl && (
          <PDFOverlayViewer
            pdfUrl={overlayUrl}
            documentName={overlayDoc.original_name}
            sourceLang={overlayDoc.original_language || 'en'}
            overlayData={overlayDoc.translation?.translated_text?.overlay}
            onOverlayGenerated={async (data) => {
              // Eski belge için yeni üretilen overlay'i kaydet
              if (!overlayDoc.translation) return;
              const existingText = overlayDoc.translation.translated_text;
              const newText = { ...existingText, pages: existingText?.pages ?? [''], overlay: data };
              await supabase.from('translations')
                .update({ translated_text: newText })
                .eq('id', overlayDoc.translation.id);
              // Local state'i de güncelle
              setDocuments(prev => prev.map(d =>
                d.id === overlayDoc.id
                  ? { ...d, translation: { ...d.translation!, translated_text: newText } }
                  : d
              ));
              setOverlayDoc(prev => prev ? { ...prev, translation: { ...prev.translation!, translated_text: newText } } : null);
              toast.success('PDF çevirisi kalıcı olarak kaydedildi');
            }}
            onClose={() => { setOverlayDoc(null); setOverlayUrl(''); }}
          />
        )}
      </AnimatePresence>

      {/* ── Özet Modal ────────────────────────────────────────── */}
      <AnimatePresence>
        {summaryDoc && (
          <motion.div
            className={styles.modalOverlay}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => { setSummaryDoc(null); summaryAbortRef.current?.abort(); }}
          >
            <motion.div
              className={styles.modal}
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              style={{ maxHeight: '70vh', display: 'flex', flexDirection: 'column' }}
            >
              <div className={styles.modalHeader}>
                <div>
                  <h2 className={styles.modalTitle}>{summaryDoc.original_name}</h2>
                  <p className={styles.modalSub}>Yapay Zeka Özeti</p>
                </div>
                <button
                  className={styles.modalClose}
                  onClick={() => { setSummaryDoc(null); summaryAbortRef.current?.abort(); }}
                >
                  <X size={20} />
                </button>
              </div>

              <div className={`${styles.modalBody} markdown-body`} style={{ flex: 1, overflowY: 'auto' }}>
                {summaryLoading && !summaryText && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--color-text-tertiary)', padding: '20px 0' }}>
                    <Loader size={18} style={{ animation: 'spin 0.8s linear infinite' }} />
                    <span>Özet oluşturuluyor…</span>
                  </div>
                )}
                {summaryText && (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm as any, remarkMath as any]}
                    rehypePlugins={[rehypeKatex as any]}
                  >
                    {summaryText}
                  </ReactMarkdown>
                )}
                {summaryLoading && summaryText && (
                  <span style={{ display: 'inline-block', width: 2, height: 14, background: 'var(--color-text-secondary)', marginLeft: 3, verticalAlign: 'middle', borderRadius: 1, animation: 'pulse 1s ease-in-out infinite' }} />
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
