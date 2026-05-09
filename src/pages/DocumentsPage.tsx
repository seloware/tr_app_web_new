/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * TransLingua — DocumentsPage (Dokümanlar Sayfası)
 *
 * Kullanıcının yüklediği ve çevirdiği tüm belgelerin listelendiği sayfa.
 * Her kart için durum, çeviri metnini görüntüleme ve silme işlemleri içerir.
 */
import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, MessageSquare, Trash2, FolderOpen, Eye, X, Languages, DownloadCloud } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { STATUS_LABELS } from '../lib/constants';
import type { Document, Translation } from '../types';
import styles from '../styles/components/documents.module.css';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import html2pdf from 'html2pdf.js';

/** Belge + varsa ilk çeviri bilgisi */
interface DocumentWithTranslation extends Document {
  translation?: Translation | null;
}

export default function DocumentsPage() {
  const { profile } = useAuth();
  const [documents, setDocuments] = useState<DocumentWithTranslation[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<DocumentWithTranslation | null>(null);
  const modalContentRef = useRef<HTMLDivElement>(null);

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

  /** PDF Olarak İndir */
  const handleDownloadPDF = () => {
    if (!modalContentRef.current || !selectedDoc) return;
    const opt = {
      margin:       15,
      filename:     `${selectedDoc.original_name.replace('.pdf', '')}_ceviri.pdf`,
      image:        { type: 'jpeg', quality: 0.98 },
      html2canvas:  { scale: 2, useCORS: true },
      jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };
    // @ts-expect-error html2pdf is not typed
    html2pdf().set(opt).from(modalContentRef.current).save();
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Dokümanlarım</h1>
          <p className={styles.desc}>Yüklediğiniz ve çevirdiğiniz tüm belgeler burada.</p>
        </div>
        <Link to="/translate" className={styles.newBtn}>
          + Yeni Çeviri
        </Link>
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
          {documents.map((doc, i) => (
            <motion.div
              key={doc.id}
              className={styles.card}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              {/* Üst kısım: ikon + isim + durum */}
              <div className={styles.cardHeader}>
                <div className={styles.cardIcon}><FileText size={20} /></div>
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
                {doc.translation?.translated_text && (
                  <button className={styles.btnView} onClick={() => setSelectedDoc(doc)}>
                    <Eye size={14} /> Görüntüle
                  </button>
                )}
                <Link to="/chat" className={styles.btnChat}>
                  <MessageSquare size={14} /> AI Sor
                </Link>
                <button className={styles.btnDelete} onClick={() => handleDelete(doc.id)}>
                  <Trash2 size={14} /> Sil
                </button>
              </div>
            </motion.div>
          ))}
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
                <div style={{ display: 'flex', gap: '12px' }}>
                  <button className={styles.btnView} style={{ background: 'var(--color-success-bg)', color: 'var(--color-success)', border: 'none', padding: '8px 12px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '500' }} onClick={handleDownloadPDF}>
                    <DownloadCloud size={16} /> PDF İndir
                  </button>
                  <button className={styles.modalClose} onClick={() => setSelectedDoc(null)}>
                    <X size={20} />
                  </button>
                </div>
              </div>
              <div className={`${styles.modalBody} markdown-body`} ref={modalContentRef}>
                <ReactMarkdown remarkPlugins={[remarkGfm as any]}>
                  {selectedDoc.translation?.translated_text?.pages.join('\n\n') || ''}
                </ReactMarkdown>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
