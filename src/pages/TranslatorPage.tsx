/**
 * TransLingua — TranslatorPage (Çeviri Sayfası)
 *
 * Yeni nesil çeviri akışı:
 *  - Sayfa sadece UI sunar; çeviri işi TranslationContext üzerinden yürütülür
 *  - Kullanıcı 'Bu sayfada kal' veya 'Arka plana al' seçeneklerinden birini seçer
 *  - Sayfa-bazında canlı ilerleme (tile grid'i + faz göstergeleri + log)
 *  - Bitince: indir (PDF), dokümanlarım, yeni çeviri
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  Upload, FileText, X, Check, AlertCircle, Download, MessageSquare,
  ArrowRight, Globe, Info, Search, MonitorPlay, BellRing, AlertTriangle,
  Loader, Pause, Layers,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { SPRING_TIGHT } from '../components/ui/motion';
import { useAuth } from '../context/AuthContext';
import { useTranslationJob, type ActiveJob } from '../context/TranslationContext';
import { SUPPORTED_LANGUAGES, TARGET_LANGUAGE } from '../lib/constants';
import { permissionState, requestPermission, notificationsSupported } from '../lib/notifications';
import { getServiceCapabilities, type ServiceCapabilities } from '../lib/pdfExtractorService';
import styles from '../styles/components/translator.module.css';

type Step = 'upload' | 'mode' | 'progress' | 'result';

export default function TranslatorPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const reduced = useReducedMotion();
  const { job, start, cancel, setMode, dismiss, downloadResult } = useTranslationJob();

  const [file, setFile] = useState<File | null>(null);
  const [sourceLang, setSourceLang] = useState('auto');
  const [chosenMode, setChosenMode] = useState<'foreground' | 'background'>('foreground');
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activity, setActivity] = useState<Array<{ ts: number; text: string }>>([]);
  const lastMsgRef = useRef<string>('');
  const [caps, setCaps] = useState<ServiceCapabilities>({ available: false });

  // Backend yetenek tespiti — bir kez kontrol
  useEffect(() => {
    let cancel = false;
    getServiceCapabilities().then(c => { if (!cancel) setCaps(c); });
    return () => { cancel = true; };
  }, []);

  // Şu anki adımı belirleme: aktif iş varsa progress/result, yoksa form
  const step: Step = useMemo(() => {
    if (job?.status === 'running') return 'progress';
    if (job && (job.status === 'completed' || job.status === 'error' || job.status === 'cancelled')) return 'result';
    if (file) return 'mode';
    return 'upload';
  }, [file, job]);

  // İlerleme mesajı log'a düşsün
  useEffect(() => {
    if (!job || job.status !== 'running') return;
    if (job.message && job.message !== lastMsgRef.current) {
      lastMsgRef.current = job.message;
      setActivity(prev => {
        const next = [...prev, { ts: Date.now(), text: job.message }];
        return next.slice(-20);
      });
    }
  }, [job?.message, job?.status]);

  // ── Sürükle-bırak ──
  const onDrag = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    if (e.type === 'dragleave') setDragActive(false);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setDragActive(false);
    const f = e.dataTransfer.files?.[0];
    if (f && f.type === 'application/pdf') setFile(f);
    else if (f) toast.error('Sadece PDF kabul edilir.');
  };
  const onSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setFile(f);
  };

  const formatSize = (b: number) => {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1024 / 1024).toFixed(1)} MB`;
  };

  const handleStart = async () => {
    if (!file || !profile) return;

    if (chosenMode === 'background') {
      // Bildirim izni iste — başarısız olursa kullanıcıyı bilgilendir
      if (notificationsSupported() && permissionState() === 'default') {
        const result = await requestPermission();
        if (result !== 'granted') {
          toast('Bildirim izni verilmedi — bitince yine de toast ile uyaracağız.', { icon: '🔔', duration: 5000 });
        }
      }
    }

    setActivity([]);
    lastMsgRef.current = '';
    await start({
      file,
      sourceLang,
      userId: profile.id,
      credits: profile.credits_remaining,
      mode: chosenMode,
    });
  };

  const handleReset = () => {
    setFile(null);
    setSourceLang('auto');
    setChosenMode('foreground');
    setActivity([]);
    dismiss();
  };

  const stepIndex = ['upload', 'mode', 'progress', 'result'].indexOf(step);

  return (
    <div className={styles.translator}>
      <h1 className={styles.pageTitle}>Belge Çevir</h1>
      <p className={styles.pageDesc}>
        PDF yükleyin — metni AI ile Türkçeye çevirelim. Grafikler, resimler ve şekiller orijinal hâliyle korunur.
      </p>

      {/* Adım çubuğu */}
      <div className={styles.steps}>
        {(['Yükle', 'Mod', 'Çeviri', 'Sonuç'] as const).map((label, i) => {
          const isDone = i < stepIndex;
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
        {/* ───────────────────── 1) Yükleme + Mod ────────────────────── */}
        {(step === 'upload' || step === 'mode') && (
          <motion.div
            key="upload"
            className={styles.card}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <motion.div
              className={`${styles.dropzone} ${dragActive ? styles.dropzoneActive : ''}`}
              onDragEnter={onDrag} onDragLeave={onDrag} onDragOver={onDrag} onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              whileHover={reduced ? undefined : { scale: 1.005 }}
              whileTap={reduced ? undefined : { scale: 0.995 }}
              animate={dragActive && !reduced ? { scale: 1.02 } : { scale: 1 }}
              transition={SPRING_TIGHT}
            >
              <input ref={fileInputRef} type="file" accept="application/pdf" onChange={onSelect} hidden />
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
                  transition={{ duration: 0.28 }}
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
                  transition={{ duration: 0.32, delay: 0.05 }}
                >
                  <div className={styles.configLabel}><Globe size={16} /> Kaynak Dil</div>
                  <div className={styles.langGrid}>
                    <button
                      className={`${styles.langOption} ${styles.langAuto} ${sourceLang === 'auto' ? styles.langSelected : ''}`}
                      onClick={() => setSourceLang('auto')}
                    >
                      <Search size={14} /> Otomatik Algıla
                    </button>
                    {SUPPORTED_LANGUAGES.map(l => (
                      <button
                        key={l.code}
                        className={`${styles.langOption} ${sourceLang === l.code ? styles.langSelected : ''}`}
                        onClick={() => setSourceLang(l.code)}
                      >
                        {l.flag} {l.name}
                      </button>
                    ))}
                  </div>
                  <div className={styles.configLabel} style={{ marginTop: 'var(--space-5)' }}>
                    <ArrowRight size={16} /> Hedef Dil
                  </div>
                  <div className={styles.targetLang}>
                    <span className={styles.targetFlag}>{TARGET_LANGUAGE.flag}</span>
                    <span className={styles.targetText}>{TARGET_LANGUAGE.nativeName} ({TARGET_LANGUAGE.name})</span>
                  </div>

                  {/* Mod seçimi */}
                  <div className={styles.configLabel} style={{ marginTop: 'var(--space-6)' }}>
                    <Layers size={16} /> Çeviri Modu
                  </div>
                  <div className={styles.modeChoice}>
                    <button
                      className={`${styles.modeCard} ${chosenMode === 'foreground' ? styles.modeCardActive : ''}`}
                      onClick={() => setChosenMode('foreground')}
                      type="button"
                    >
                      <span className={styles.modeCardTitle}>
                        <MonitorPlay size={14} /> Bu sayfada kal
                      </span>
                      <span className={styles.modeCardDesc}>
                        İlerlemeyi canlı izleyin. Tarayıcı sekmesini kapatmayın.
                      </span>
                    </button>
                    <button
                      className={`${styles.modeCard} ${chosenMode === 'background' ? styles.modeCardActive : ''}`}
                      onClick={() => setChosenMode('background')}
                      type="button"
                    >
                      <span className={styles.modeCardTitle}>
                        <BellRing size={14} /> Arka planda çevir
                      </span>
                      <span className={styles.modeCardDesc}>
                        Diğer sayfalarda gezinin — bittiğinde tarayıcı bildirimi göndereceğiz.
                      </span>
                    </button>
                  </div>

                  {chosenMode === 'foreground' && (
                    <div className={styles.warning}>
                      <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                      <span>
                        <strong>Sayfayı veya sekmeyi kapatmayın.</strong> Çeviri bu pencerede çalışır. Diğer sekmelere geçebilirsiniz, ama tarayıcıyı kapatırsanız iş kaybolur. Daha rahat etmek için "Arka planda çevir" modunu seçin.
                      </span>
                    </div>
                  )}
                  {chosenMode === 'background' && (
                    <div className={styles.warning} style={{ background: 'var(--color-accent-light)', borderColor: 'var(--color-accent-medium)', color: 'var(--color-accent)' }}>
                      <BellRing size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                      <span>
                        Çeviri başladıktan sonra dilediğiniz sayfaya gidebilirsiniz. Bittiğinde tarayıcı bildirimi + bildirim çubuğu ile uyaracağız. Tarayıcıyı kapatmamaya yine dikkat edin.
                      </span>
                    </div>
                  )}

                  <div className={styles.demoNotice}>
                    <Info size={14} />
                    <span>
                      Sayfa başına 1 kredi. Mevcut: <strong>{profile?.credits_remaining ?? 0}</strong> kredi.
                    </span>
                  </div>

                  {/* Backend yetenek bilgisi (kalite ipucu) */}
                  <div
                    className={styles.demoNotice}
                    style={{
                      background: caps.redactionWrite ? 'var(--color-success-bg)' : 'var(--color-bg-alt)',
                      borderColor: caps.redactionWrite ? 'rgba(48, 209, 88, 0.3)' : 'var(--color-border)',
                      color: caps.redactionWrite ? 'var(--color-success)' : 'var(--color-text-secondary)',
                    }}
                  >
                    {caps.redactionWrite ? <Check size={14} /> : <AlertTriangle size={14} />}
                    <span>
                      {caps.redactionWrite ? (
                        <><strong>Profesyonel mod aktif:</strong> PDF servisi (v{caps.version}) bağlı — orijinal metin gerçek redaction ile silinir, kutusuz çıktı.</>
                      ) : (
                        <><strong>Standart mod:</strong> PDF servisi bağlı değil. Çeviri çalışır ama çıktı kalitesi için <code style={{ background: 'var(--color-surface)', padding: '1px 5px', borderRadius: 4, fontFamily: 'monospace', fontSize: 12 }}>cd backend &amp;&amp; pip install -r requirements.txt &amp;&amp; uvicorn main:app --port 5050</code> ile servisi başlatın.</>
                      )}
                    </span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className={styles.actions}>
              <motion.button
                className={styles.btnPrimary}
                onClick={handleStart}
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

        {/* ───────────────────── 2) İlerleme ─────────────────────── */}
        {step === 'progress' && job && (
          <motion.div
            key="progress"
            className={styles.card}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <ProgressView job={job} activity={activity} onCancel={cancel} onToggleMode={() => setMode(job.mode === 'foreground' ? 'background' : 'foreground')} />
          </motion.div>
        )}

        {/* ───────────────────── 3) Sonuç ─────────────────────── */}
        {step === 'result' && job && (
          <motion.div
            key="result"
            className={styles.card}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <div className={styles.resultSection}>
              {job.status === 'error' || job.status === 'cancelled' ? (
                <>
                  <motion.div
                    className={`${styles.resultIcon} ${styles.resultError}`}
                    initial={{ scale: 0, rotate: -30 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: 'spring', stiffness: 360, damping: 16 }}
                  >
                    <AlertCircle size={32} />
                  </motion.div>
                  <h2 className={styles.resultTitle}>
                    {job.status === 'cancelled' ? 'Çeviri İptal Edildi' : 'Çeviri Başarısız'}
                  </h2>
                  <p className={styles.resultDesc}>{job.errorMessage || job.message}</p>
                </>
              ) : (
                <>
                  <motion.div
                    className={`${styles.resultIcon} ${styles.resultSuccess}`}
                    initial={{ scale: 0 }}
                    animate={{ scale: [0, 1.15, 1] }}
                    transition={{ duration: 0.5, times: [0, 0.6, 1] }}
                  >
                    <Check size={32} />
                  </motion.div>
                  <h2 className={styles.resultTitle}>Çeviri Tamamlandı!</h2>
                  <p className={styles.resultDesc}>
                    Belgeniz Türkçeye çevrildi — grafikler, resimler ve şekiller orijinal kalitede korundu.
                  </p>
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
                  onClick={handleReset}
                  variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
                >
                  Yeni Çeviri
                </motion.button>
                {job.status === 'completed' && (
                  <>
                    <motion.button
                      className={`${styles.resultBtn} ${styles.resultBtnPrimary}`}
                      onClick={downloadResult}
                      variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
                    >
                      <Download size={16} /> PDF İndir
                    </motion.button>
                    <motion.button
                      className={styles.resultBtn}
                      onClick={() => navigate('/documents')}
                      variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
                    >
                      <FileText size={16} /> Dokümanlarım
                    </motion.button>
                    <motion.div variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}>
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

// ─── Alt bileşen: ilerleme görünümü ────────────────────────────────────────
function ProgressView({
  job, activity, onCancel, onToggleMode,
}: {
  job: ActiveJob;
  activity: Array<{ ts: number; text: string }>;
  onCancel: () => void;
  onToggleMode: () => void;
}) {
  const circumference = 2 * Math.PI * 52;
  const dash = circumference - (job.progress / 100) * circumference;

  const phases = [
    { key: 'uploading', label: 'Yükleme', match: ['uploading'] },
    { key: 'extracting', label: 'Metin çıkarma', match: ['extracting', 'loading'] },
    { key: 'translating', label: 'AI çevirisi', match: ['translating'] },
    { key: 'saving', label: 'Kaydetme', match: ['saving', 'finalizing'] },
  ] as const;

  const order = ['uploading', 'loading', 'extracting', 'translating', 'finalizing', 'saving', 'completed'];
  const currentIdx = order.indexOf(job.phase);

  return (
    <div className={styles.progressSection}>
      <motion.div
        className={styles.progressRing}
        animate={{ scale: [1, 1.04, 1] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
      >
        <svg width="120" height="120" viewBox="0 0 120 120">
          <defs>
            <linearGradient id="progressGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#0057FF" />
              <stop offset="100%" stopColor="#0EA5E9" />
            </linearGradient>
          </defs>
          <circle className={styles.progressCircleBg} cx="60" cy="60" r="52" />
          <circle className={styles.progressCircle} cx="60" cy="60" r="52" strokeDasharray={circumference} strokeDashoffset={dash} />
        </svg>
        <div className={styles.progressPercent}>{job.progress}%</div>
      </motion.div>

      <motion.div
        key={job.message}
        className={styles.progressStatus}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        {job.message}
      </motion.div>

      <div className={styles.progressDetail}>
        {job.totalPages > 0 && (
          <>
            {job.completedPages}/{job.totalPages} sayfa
            {job.etaSeconds != null && job.etaSeconds > 0 && ` • ~${formatEta(job.etaSeconds)} kaldı`}
          </>
        )}
        {job.detail && <span style={{ marginLeft: 8 }}>• {job.detail}</span>}
      </div>

      {/* Faz göstergeleri */}
      <div className={styles.phaseSteps}>
        {phases.map((p, i) => {
          const phaseStartIdx = Math.min(...p.match.map(m => order.indexOf(m)));
          const isActive = p.match.some(m => m === job.phase);
          const isDone = currentIdx > phaseStartIdx && !isActive;
          return (
            <div
              key={p.key}
              className={`${styles.phaseRow} ${isActive ? styles.phaseRowActive : ''} ${isDone ? styles.phaseRowDone : ''}`}
            >
              <div className={styles.phaseDot}>
                {isDone ? <Check size={10} /> : isActive ? <Loader size={10} style={{ animation: 'spin 0.9s linear infinite' }} /> : i + 1}
              </div>
              <span>{p.label}</span>
            </div>
          );
        })}
      </div>

      {/* Sayfa tile grid'i */}
      {job.pageStatuses && job.totalPages > 0 && (
        <div className={styles.tilesWrap}>
          <div className={styles.tilesTitle}>
            <span>Sayfa Durumu</span>
            <span>{job.completedPages}/{job.totalPages}</span>
          </div>
          <div className={styles.tiles}>
            {Array.from({ length: job.totalPages }, (_, i) => {
              const s = job.pageStatuses![i] ?? 0;
              const cls =
                s === 3 ? styles.tileDone :
                s === 2 ? styles.tileTranslating :
                s === 1 ? styles.tileExtracting :
                s === 4 ? styles.tileError : styles.tilePending;
              return (
                <div key={i} className={`${styles.tile} ${cls}`} title={`Sayfa ${i + 1}`}>
                  {i + 1}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Canlı log */}
      {activity.length > 0 && (
        <div className={styles.activityLog}>
          {activity.slice(-6).map((a, i) => (
            <div key={i} className={styles.activityRow}>
              <span className={styles.activityTime}>{formatClock(a.ts)}</span>
              <span>{a.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* Orta kontroller */}
      <div className={styles.midControls}>
        <button className={styles.midBtn} onClick={onToggleMode} type="button">
          {job.mode === 'foreground'
            ? <><BellRing size={13} /> Arka plana al</>
            : <><MonitorPlay size={13} /> Sayfada izle</>}
        </button>
        <button className={`${styles.midBtn} ${styles.midBtnDanger}`} onClick={onCancel} type="button">
          <Pause size={13} /> İptal
        </button>
      </div>

      {job.mode === 'foreground' && (
        <div className={styles.warning} style={{ marginTop: 'var(--space-5)' }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>Bu sekmeyi kapatmayın. Diğer sayfalara gitmek için <strong>Arka plana al</strong>'a tıklayın.</span>
        </div>
      )}
    </div>
  );
}

function formatEta(sec: number): string {
  if (sec < 60) return `${sec} sn`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m} dk ${s} sn`;
}

function formatClock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}
