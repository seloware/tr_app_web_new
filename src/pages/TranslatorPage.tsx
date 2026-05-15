/**
 * TransLingua — TranslatorPage (Çeviri Sayfası)
 *
 * Kullanıcının PDF belgelerini yükleyip çeviriye gönderdiği
 * adım adım sihirbaz arayüzü. Supabase Storage + DB entegrasyonu vardır.
 * AI motoru: bağlandığında translateDocument() ve detectLanguage() devreye girer.
 */
import { useState, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Upload, FileText, X, Check, AlertCircle, Download, MessageSquare, ArrowRight, Globe, Info, Search } from 'lucide-react';
import { exportMarkdownToPDF } from '../lib/exporters';
import { SPRING_TIGHT } from '../components/ui/motion';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { translatePDFSmart, detectLanguage } from '../lib/ai';
import * as pdfjsLib from 'pdfjs-dist';

// Set up PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
import { SUPPORTED_LANGUAGES, TARGET_LANGUAGE } from '../lib/constants';
import type { TranslationStep } from '../types';
import styles from '../styles/components/translator.module.css';

export default function TranslatorPage() {
  const { profile } = useAuth();
  const reduced = useReducedMotion();
  const [step, setStep] = useState<TranslationStep>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [sourceLang, setSourceLang] = useState('auto');
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [detailText, setDetailText] = useState('');
  const [error, setError] = useState('');
  const [_resultDocId, setResultDocId] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [translatedText, setTranslatedText] = useState('');

  // ── Sürükle-bırak yöneticileri ──────────────────────────────
  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setDragActive(false);
    const f = e.dataTransfer.files?.[0];
    if (f && f.type === 'application/pdf') setFile(f);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setFile(f);
  };

  /** Byte cinsinden boyutu okunabilir formata çevirir */
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  /**
   * Ana çeviri akışı:
   * 1. Dosyayı Supabase Storage'a yükle
   * 2. Veritabanında doküman kaydı oluştur
   * 3. Metin çıkar
   * 4. Dil tespiti yap (veya kullanıcı seçimini kullan)
   * 5. AI ile çevir
   * 6. Çeviri kaydını oluştur
   * 7. Doküman durumunu güncelle ve krediyi düş
   */
  const startTranslation = async () => {
    if (!file || !profile) return;
    setStep('progress'); setProgress(0); setError('');

    try {
      // Adım 1: Supabase Storage'a yükle
      setStatusText('Dosya yükleniyor'); setDetailText(file.name); setProgress(10);
      const filePath = `${profile.id}/${Date.now()}_${file.name}`;
      const { error: uploadErr } = await supabase.storage.from('originals').upload(filePath, file);
      if (uploadErr) throw new Error('Dosya yüklenemedi: ' + uploadErr.message);

      // Adım 2: Doküman kaydı oluştur
      setStatusText('Doküman kaydediliyor'); setProgress(20);
      const { data: docData, error: docErr } = await supabase.from('documents').insert({
        user_id: profile.id,
        original_name: file.name,
        original_storage_path: filePath,
        file_size_bytes: file.size,
        status: 'processing',
      }).select().single();
      if (docErr) throw new Error('Doküman oluşturulamadı');
      const docId = docData.id;

      // Adım 3: Metin çıkar — sayfa sayısını ve metin yoğunluğunu ölç
      setStatusText('PDF analiz ediliyor'); setDetailText('Sayfa yapısı inceleniyor...'); setProgress(20);

      let extractedText = '';
      let pageCount = 0;
      try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        pageCount = pdf.numPages;
        let fullText = '';

        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          // Metin öğelerini aralarına boşluk bırakarak birleştir
          const pageText = textContent.items
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((item: any) => ('str' in item ? item.str : ''))
            .join(' ');
          fullText += pageText + '\n\n';
          setProgress(20 + Math.round((i / pdf.numPages) * 10));
        }
        extractedText = fullText.trim();
      } catch (pdfErr) {
        throw new Error('PDF okunamadı: ' + (pdfErr instanceof Error ? pdfErr.message : 'Bilinmeyen hata'));
      }

      // Adım 4: Dil tespiti (metin yok ya da az ise multimodal mod kullanılacak)
      const avgCharsPerPage = pageCount > 0 ? extractedText.length / pageCount : 0;
      const isImageHeavy = avgCharsPerPage < 80;

      let detectedLang = sourceLang;
      if (sourceLang === 'auto') {
        setStatusText('Dil tespit ediliyor'); setProgress(33);
        const sampleText = extractedText.slice(0, 1000);
        detectedLang = sampleText.length > 20
          ? await detectLanguage(sampleText)
          : 'en'; // metin yoksa varsayılan
        setDetailText(`Tespit edilen dil: ${detectedLang.toUpperCase()}`);
      }

      // Sayfa sayısını güncelle
      await supabase.from('documents').update({ page_count: pageCount }).eq('id', docId);

      // Adım 5: Akıllı çeviri modu seç
      if (isImageHeavy) {
        setStatusText('Multimodal çeviri');
        setDetailText('Taranmış/görsel PDF — AI doğrudan okuyor...');
      } else {
        setStatusText('Çevriliyor');
        setDetailText(`${pageCount} sayfa işleniyor...`);
      }
      setProgress(40);

      const { result: translated } = await translatePDFSmart(
        file,
        extractedText,
        pageCount,
        {
          sourceLang: detectedLang,
          targetLang: TARGET_LANGUAGE.code,
          onProgress: ({ chunk, totalChunks, pct }) => {
            setProgress(40 + Math.round((pct / 100) * 48));
            if (!isImageHeavy) {
              setDetailText(`${chunk}/${totalChunks} bölüm tamamlandı`);
            }
          },
        },
      );
      setProgress(90);

      // Adım 6: Çeviri kaydı oluştur — tüm metin tek alanda Markdown
      setStatusText('Sonuç kaydediliyor'); setProgress(95);
      // Kredi maliyeti = sayfa sayısı (en az 1)
      const creditsCost = Math.max(1, pageCount);
      await supabase.from('translations').insert({
        document_id: docId, user_id: profile.id,
        target_language: TARGET_LANGUAGE.code,
        translated_text: { pages: [translated], pageCount },
        progress: 100, status: 'completed',
        credits_used: creditsCost,
      });

      // Adım 7: Dokümanı güncelle ve krediyi düş (sayfa başına 1 kredi)
      await supabase.from('documents').update({ status: 'completed', original_language: detectedLang }).eq('id', docId);
      await supabase.from('profiles').update({
        credits_remaining: Math.max(0, profile.credits_remaining - creditsCost),
      }).eq('id', profile.id);

      setProgress(100); setResultDocId(docId); setTranslatedText(translated); setStep('result');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Çeviri sırasında hata oluştu';
      setError(msg); setStep('result');
    }
  };

  const stepIndex = ['upload', 'config', 'progress', 'result'].indexOf(step);
  const circumference = 2 * Math.PI * 52;
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  return (
    <div className={styles.translator}>
      <h1 className={styles.pageTitle}>Belge Çevir</h1>
      <p className={styles.pageDesc}>PDF belgenizi yükleyin, AI ile profesyonel çeviri alın.</p>

      {/* İlerleme adım çubuğu */}
      <div className={styles.steps}>
        {(['Yükle', 'Ayarla', 'Çeviri', 'Sonuç'] as const).map((label, i) => {
          const isDone   = i < stepIndex;
          const isActive = i === stepIndex;
          return (
            <div key={i} className={styles.step}>
              <div className={`${styles.stepDot} ${isDone ? styles.stepDotDone : ''} ${isActive ? styles.stepDotActive : ''}`}>
                {isDone ? '✓' : i + 1}
              </div>
              <span className={`${styles.stepName} ${isDone ? styles.stepNameDone : ''} ${isActive ? styles.stepNameActive : ''}`}>
                {label}
              </span>
              {i < 3 && (
                <div className={`${styles.stepLine} ${isDone ? styles.stepLineDone : ''} ${isActive ? styles.stepLineActive : ''}`} />
              )}
            </div>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        {/* Yükleme ve Yapılandırma Adımı */}
        {(step === 'upload' || step === 'config') && (
          <motion.div key="upload" className={styles.card} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
            <motion.div
              className={`${styles.dropzone} ${dragActive ? styles.dropzoneActive : ''}`}
              onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              whileHover={reduced ? undefined : { scale: 1.005 }}
              whileTap={reduced ? undefined : { scale: 0.995 }}
              animate={dragActive && !reduced ? { scale: 1.02 } : { scale: 1 }}
              transition={SPRING_TIGHT}
            >
              <input ref={fileInputRef} type="file" accept="application/pdf" onChange={handleFileSelect} hidden />
              <motion.div
                className={styles.dropIcon}
                animate={reduced ? undefined : { y: [0, -6, 0] }}
                transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
              >
                <Upload size={28} />
              </motion.div>
              <div className={styles.dropTitle}>PDF dosyanızı sürükleyin veya seçin</div>
              <div className={styles.dropHint}>Sadece PDF • Maks. 100 MB</div>
            </motion.div>

            <AnimatePresence>
              {file && (
                <motion.div
                  className={styles.fileInfo}
                  initial={{ opacity: 0, y: -8, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: 'auto' }}
                  exit={{ opacity: 0, y: -8, height: 0 }}
                  transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                  style={{ overflow: 'hidden' }}
                >
                  <div className={styles.fileInfoIcon}><FileText size={20} /></div>
                  <div className={styles.fileInfoText}>
                    <div className={styles.fileInfoName}>{file.name}</div>
                    <div className={styles.fileInfoSize}>{formatSize(file.size)}</div>
                  </div>
                  <motion.button
                    className={styles.fileRemove}
                    onClick={() => setFile(null)}
                    whileHover={reduced ? undefined : { rotate: 90, scale: 1.1 }}
                    whileTap={reduced ? undefined : { scale: 0.9 }}
                    transition={SPRING_TIGHT}
                  >
                    <X size={18} />
                  </motion.button>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {file && (
                <motion.div
                  className={styles.configSection}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1], delay: 0.05 }}
                >
                  <div className={styles.configLabel}><Globe size={16} /> Kaynak Dil</div>
                  <motion.div
                    className={styles.langGrid}
                    initial="hidden"
                    animate="visible"
                    variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.025, delayChildren: 0.1 } } }}
                  >
                    <motion.button
                      className={`${styles.langOption} ${styles.langAuto} ${sourceLang === 'auto' ? styles.langSelected : ''}`}
                      onClick={() => setSourceLang('auto')}
                      variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
                      whileHover={reduced ? undefined : { y: -2 }}
                      whileTap={reduced ? undefined : { scale: 0.96 }}
                      transition={SPRING_TIGHT}
                    >
                      <Search size={14} /> Otomatik Algıla
                    </motion.button>
                    {SUPPORTED_LANGUAGES.map(l => (
                      <motion.button
                        key={l.code}
                        className={`${styles.langOption} ${sourceLang === l.code ? styles.langSelected : ''}`}
                        onClick={() => setSourceLang(l.code)}
                        variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
                        whileHover={reduced ? undefined : { y: -2 }}
                        whileTap={reduced ? undefined : { scale: 0.94 }}
                        transition={SPRING_TIGHT}
                      >
                        {l.flag} {l.name}
                      </motion.button>
                    ))}
                  </motion.div>
                  <div className={styles.configLabel} style={{ marginTop: 'var(--space-5)' }}><ArrowRight size={16} /> Hedef Dil</div>
                  <div className={styles.targetLang}>
                    <span className={styles.targetFlag}>{TARGET_LANGUAGE.flag}</span>
                    <span className={styles.targetText}>{TARGET_LANGUAGE.nativeName} ({TARGET_LANGUAGE.name})</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {file && (
              <div className={styles.demoNotice}>
                <Info size={14} />
                <span>Çeviri sayfa başına 1 kredi tüketir. Uzun belgeler paralel işlenir.</span>
              </div>
            )}

            <div className={styles.actions}>
              <motion.button
                className={styles.btnPrimary}
                onClick={startTranslation}
                disabled={!file}
                whileHover={reduced || !file ? undefined : { y: -2 }}
                whileTap={reduced || !file ? undefined : { scale: 0.97 }}
                transition={SPRING_TIGHT}
              >
                Çeviriyi Başlat
              </motion.button>
            </div>
          </motion.div>
        )}

        {/* İşlem Adımı */}
        {step === 'progress' && (
          <motion.div key="progress" className={styles.card} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
            <div className={styles.progressSection}>
              <motion.div
                className={styles.progressRing}
                animate={reduced ? undefined : { scale: [1, 1.04, 1] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
              >
                <svg width="120" height="120" viewBox="0 0 120 120">
                  <defs><linearGradient id="progressGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#0057FF" /><stop offset="100%" stopColor="#0EA5E9" /></linearGradient></defs>
                  <circle className={styles.progressCircleBg} cx="60" cy="60" r="52" />
                  <circle className={styles.progressCircle} cx="60" cy="60" r="52" strokeDasharray={circumference} strokeDashoffset={strokeDashoffset} />
                </svg>
                <div className={styles.progressPercent}>{progress}%</div>
              </motion.div>
              <motion.div
                key={statusText}
                className={styles.progressStatus}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
              >
                {statusText}
              </motion.div>
              <motion.div
                key={detailText}
                className={styles.progressDetail}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4 }}
              >
                {detailText}
              </motion.div>
            </div>
          </motion.div>
        )}

        {/* Sonuç Adımı */}
        {step === 'result' && (
          <motion.div key="result" className={styles.card} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
            <div className={styles.resultSection}>
              {error ? (
                <>
                  <motion.div
                    className={`${styles.resultIcon} ${styles.resultError}`}
                    initial={{ scale: 0, rotate: -30 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: 'spring', stiffness: 360, damping: 16 }}
                  >
                    <AlertCircle size={32} />
                  </motion.div>
                  <h2 className={styles.resultTitle}>Çeviri Başarısız</h2>
                  <p className={styles.resultDesc}>{error}</p>
                </>
              ) : (
                <>
                  <motion.div
                    className={`${styles.resultIcon} ${styles.resultSuccess}`}
                    initial={{ scale: 0 }}
                    animate={{ scale: [0, 1.15, 1] }}
                    transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], times: [0, 0.6, 1] }}
                  >
                    <Check size={32} />
                  </motion.div>
                  <motion.h2
                    className={styles.resultTitle}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15, duration: 0.4 }}
                  >
                    Çeviri Tamamlandı!
                  </motion.h2>
                  <motion.p
                    className={styles.resultDesc}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.22, duration: 0.4 }}
                  >
                    Belgeniz başarıyla Türkçe'ye çevrildi.
                  </motion.p>
                </>
              )}
              <motion.div
                className={styles.resultActions}
                initial="hidden"
                animate="visible"
                variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.06, delayChildren: 0.3 } } }}
              >
                <motion.button
                  className={styles.resultBtn}
                  onClick={() => { setStep('upload'); setFile(null); setError(''); }}
                  variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
                  whileHover={reduced ? undefined : { y: -2 }}
                  whileTap={reduced ? undefined : { scale: 0.96 }}
                  transition={SPRING_TIGHT}
                >
                  Yeni Çeviri
                </motion.button>
                {!error && (
                  <>
                    <motion.button
                      className={`${styles.resultBtn} ${styles.resultBtnPrimary}`}
                      onClick={() => void exportMarkdownToPDF(translatedText, {
                        filename: `${(file?.name ?? 'ceviri').replace(/\.pdf$/i, '')}_TR.pdf`,
                        title: file?.name?.replace(/\.pdf$/i, ''),
                        subtitle: `Türkçe çeviri · ${new Date().toLocaleDateString('tr-TR')}`,
                      })}
                      disabled={!translatedText}
                      variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
                      whileHover={reduced ? undefined : { y: -2 }}
                      whileTap={reduced ? undefined : { scale: 0.96 }}
                      transition={SPRING_TIGHT}
                    >
                      <Download size={16} /> PDF İndir
                    </motion.button>
                    <motion.div
                      variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
                      whileHover={reduced ? undefined : { y: -2 }}
                      whileTap={reduced ? undefined : { scale: 0.96 }}
                      transition={SPRING_TIGHT}
                    >
                      <Link to="/documents" className={styles.resultBtn}><FileText size={16} /> Dokümanlarım</Link>
                    </motion.div>
                    <motion.div
                      variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
                      whileHover={reduced ? undefined : { y: -2 }}
                      whileTap={reduced ? undefined : { scale: 0.96 }}
                      transition={SPRING_TIGHT}
                    >
                      <Link to="/chat" className={styles.resultBtn}><MessageSquare size={16} /> AI'a Sor</Link>
                    </motion.div>
                  </>
                )}
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
