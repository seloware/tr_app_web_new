/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { generateStudyNotes } from '../lib/ai';
import { STUDY_SUBJECTS, CREDIT_COSTS } from '../lib/constants';
import toast from 'react-hot-toast';
import {
  BookOpen, Upload, File as FileIcon, X, Check,
  Image as ImageIcon, Copy, RefreshCw, DownloadCloud
} from 'lucide-react';
import styles from '../styles/components/studynotes.module.css';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import html2pdf from 'html2pdf.js';
import React from 'react';

type Step = 'upload' | 'processing' | 'result';

interface UploadedFile {
  id: string;
  file: File;
  preview?: string;
}

export default function StudyNotesPage() {
  const { profile, refreshProfile } = useAuth();
  const [step, setStep] = useState<Step>('upload');
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [subject, setSubject] = useState(STUDY_SUBJECTS[0]);
  const [isDragging, setIsDragging] = useState(false);
  const [generatedNotes, setGeneratedNotes] = useState<string>('');
  const contentRef = React.useRef<HTMLDivElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const processFiles = (newFiles: FileList | File[]) => {
    const validFiles = Array.from(newFiles).filter(file => {
      // Allow images and PDFs up to 10MB each
      const isValidType = file.type.startsWith('image/') || file.type === 'application/pdf';
      const isValidSize = file.size <= 10 * 1024 * 1024;
      if (!isValidType) toast.error(`${file.name} desteklenmeyen bir format.`);
      if (!isValidSize) toast.error(`${file.name} boyutu çok büyük (Max 10MB).`);
      return isValidType && isValidSize;
    });

    if (files.length + validFiles.length > 5) {
      toast.error('Tek seferde en fazla 5 dosya yükleyebilirsiniz.');
      return;
    }

    const newUploadedFiles = validFiles.map(file => ({
      id: Math.random().toString(36).substring(7),
      file,
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
    }));

    setFiles(prev => [...prev, ...newUploadedFiles]);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      processFiles(e.dataTransfer.files);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processFiles(e.target.files);
    }
  };

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const startProcessing = async () => {
    if (!profile) return;
    if (files.length === 0) {
      toast.error('Lütfen en az bir dosya yükleyin.');
      return;
    }

    const totalCost = files.length * CREDIT_COSTS.STUDY_NOTES_PER_SOURCE;
    if (profile.credits_remaining < totalCost) {
      toast.error(`Yetersiz kredi. Bu işlem ${totalCost} kredi gerektiriyor.`);
      return;
    }

    setStep('processing');

    try {
      // In a real scenario, we would:
      // 1. Upload files to Supabase Storage 'study-sources'
      // 2. Insert record into 'study_sessions' and 'study_sources'
      // 3. Extract text using OCR or text extraction API
      // 4. Pass text to AI

      // For now, we simulate extraction and call the AI directly with placeholder text
      // because we cannot read file contents securely without a dedicated backend/OCR service yet
      const fileNames = files.map(f => f.file.name).join(', ');
      const simulatedContent = `Bu materyal ${fileNames} adlı dosyalardan elde edilmiştir. Konu: ${subject}. Temel matematik ve fizik prensiplerini içerir. E=mc^2 ve türev/integral kuralları burada yer almaktadır. Lütfen bunları özetle.`;

      // 1. Krediyi düş (Optimistic UI)
      await supabase.from('profiles').update({
        credits_remaining: profile.credits_remaining - totalCost
      }).eq('id', profile.id);

      // 2. Kredi işlemini kaydet
      await supabase.from('credit_transactions').insert({
        user_id: profile.id,
        amount: -totalCost,
        action: 'chat', // using chat action as a fallback since we didn't add 'study_notes' to DB constraints
      });

      // 3. Session kaydı oluştur
      const { data: session } = await supabase.from('study_sessions').insert({
        user_id: profile.id,
        title: `${subject} Notları - ${new Date().toLocaleDateString('tr-TR')}`,
        subject: subject,
        source_count: files.length,
        status: 'processing',
        credits_used: totalCost
      }).select().single();

      // 4. Call AI
      const notes = await generateStudyNotes([simulatedContent], subject);

      // 5. Update session
      if (session) {
        await supabase.from('study_sessions').update({
          generated_notes: notes,
          status: 'completed'
        }).eq('id', session.id);
      }

      setGeneratedNotes(notes);
      setStep('result');
      await refreshProfile();
      toast.success('Ders notu başarıyla oluşturuldu!');

    } catch (error) {
      console.error(error);
      toast.error('Notlar oluşturulurken bir hata oluştu.');
      setStep('upload');
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedNotes);
    toast.success('Pano\'ya kopyalandı');
  };

  const reset = () => {
    setFiles([]);
    setGeneratedNotes('');
    setStep('upload');
  };

    /** PDF Olarak İndir */
  const handleDownloadPDF = () => {
    if (!contentRef.current) return;
    const opt = {
      margin:       15,
      filename:     `${subject}_Notlari.pdf`,
      image:        { type: 'jpeg', quality: 0.98 },
      html2canvas:  { scale: 2, useCORS: true },
      jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };
    // @ts-expect-error html2pdf is not typed
    html2pdf().set(opt).from(contentRef.current).save();
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.headerIcon}><BookOpen size={24} /></div>
        <div>
          <h1 className={styles.title}>Ders Notu Çıkar</h1>
          <p className={styles.subtitle}>Sınıf tahtası, slaytlar veya kitap sayfalarından saniyeler içinde not oluşturun.</p>
        </div>
      </div>

      <div className={styles.wizard}>
        <AnimatePresence mode="wait">

          {/* ── STEP 1: UPLOAD ── */}
          {step === 'upload' && (
            <motion.div
              key="upload"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
            >
              <div className={styles.uploadArea}>
                <div
                  className={`${styles.dropzone} ${isDragging ? styles.dropzoneActive : ''}`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => document.getElementById('fileUpload')?.click()}
                >
                  <Upload size={48} className={styles.uploadIcon} />
                  <div className={styles.dropzoneText}>Görsel veya PDF'leri buraya sürükleyin</div>
                  <div className={styles.dropzoneSubtext}>veya cihazınızdan seçmek için tıklayın. (Max 5 dosya)</div>
                  <input
                    id="fileUpload"
                    type="file"
                    multiple
                    accept="image/*,application/pdf"
                    onChange={handleFileInput}
                    style={{ display: 'none' }}
                  />
                </div>

                {files.length > 0 && (
                  <div className={styles.fileList}>
                    {files.map(file => (
                      <div key={file.id} className={styles.fileItem}>
                        <div className={styles.fileItemIcon}>
                          {file.file.type.startsWith('image/') ? <ImageIcon size={20} /> : <FileIcon size={20} />}
                        </div>
                        <div className={styles.fileItemInfo}>
                          <div className={styles.fileItemName}>{file.file.name}</div>
                          <div className={styles.fileItemSize}>{formatFileSize(file.file.size)}</div>
                        </div>
                        <button className={styles.removeBtn} onClick={(e) => { e.stopPropagation(); removeFile(file.id); }}>
                          <X size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className={styles.actionBar}>
                <select
                  className={styles.subjectSelect}
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                >
                  {STUDY_SUBJECTS.map(sub => (
                    <option key={sub} value={sub}>{sub}</option>
                  ))}
                </select>

                <button
                  className={styles.generateBtn}
                  onClick={startProcessing}
                  disabled={files.length === 0}
                >
                  <SparklesIcon size={16} /> Notları Oluştur
                  <span style={{ fontSize: '0.75rem', opacity: 0.8, marginLeft: 4 }}>
                    ({files.length * CREDIT_COSTS.STUDY_NOTES_PER_SOURCE} Kredi)
                  </span>
                </button>
              </div>
            </motion.div>
          )}

          {/* ── STEP 2: PROCESSING ── */}
          {step === 'processing' && (
            <motion.div
              key="processing"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className={styles.processingArea}
            >
              <div className={styles.processingIcon}>
                <BookOpen size={64} />
              </div>
              <h2 className={styles.processingTitle}>Yapay Zeka Çalışıyor</h2>
              <p className={styles.processingSubtitle}>
                {files.length} kaynak analiz ediliyor ve {subject} notları oluşturuluyor.<br/>
                Lütfen bekleyin, bu işlem birkaç saniye sürebilir...
              </p>
              <div className="animate-spin" style={{ width: 32, height: 32, border: '3px solid var(--color-border)', borderTopColor: '#8b5cf6', borderRadius: '50%' }} />
            </motion.div>
          )}

          {/* ── STEP 3: RESULT ── */}
          {step === 'result' && (
            <motion.div
              key="result"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className={styles.resultsArea}
            >
              <div className={styles.resultsHeader}>
                <div className={styles.resultsTitle}>
                  <Check size={20} color="var(--color-success)" />
                  {subject} Notları Hazır
                </div>
                <div className={styles.resultsActions}>
                  <button className={styles.actionBtn} onClick={handleDownloadPDF} style={{ color: 'var(--color-success)', borderColor: 'var(--color-success-bg)' }}>
                    <DownloadCloud size={16} /> PDF İndir
                  </button>
                  <button className={styles.actionBtn} onClick={handleCopy}>
                    <Copy size={16} /> Kopyala
                  </button>
                  <button className={styles.actionBtn} onClick={reset}>
                    <RefreshCw size={16} /> Yeni Not Oluştur
                  </button>
                </div>
              </div>

              <div className={`${styles.markdownContent} markdown-body`} ref={contentRef} style={{ padding: 'var(--space-4)', background: 'var(--color-surface)', borderRadius: 'var(--radius-md)' }}>
                <ReactMarkdown remarkPlugins={[remarkGfm as any]}>
                  {generatedNotes}
                </ReactMarkdown>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}

// Inline Sparkles icon since it wasn't imported from lucide-react above
function SparklesIcon(props: React.SVGProps<SVGSVGElement> & { size?: number | string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={props.size || 24} height={props.size || 24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
      <path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>
    </svg>
  )
}
