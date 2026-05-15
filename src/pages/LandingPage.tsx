import { useRef, useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence as AP, useReducedMotion } from 'framer-motion';
import {
  Languages, FileText, Brain, ArrowRight, Check,
  Shield, BookOpen, Star, Zap, FileType, MessageSquare,
  Globe, FileCode, Loader, RotateCcw,
} from 'lucide-react';
import { PRICING_PLANS } from '../lib/constants';
import { Magnetic } from '../components/ui/motion';
import styles from '../styles/components/landing.module.css';

/* ── Animation variants ───────────────────────────────────── */
const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.07, duration: 0.55, ease: [0.25, 0.46, 0.45, 0.94] as const },
  }),
};

const scrollTo = (id: string) => (e: React.MouseEvent) => {
  e.preventDefault();
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

/* ── Data ─────────────────────────────────────────────────── */
const TESTIMONIALS = [
  {
    quote: 'Bir haftada 3 makale okudum — hepsini TransLingua ile çevirdim. Normalde birkaç günümü alırdı.',
    name: 'Zeynep A.',
    role: 'Tıp Fakültesi, 4. Sınıf',
    stars: 5,
  },
  {
    quote: 'İngilizce slaytlarımı yükleyip ders notuna dönüştürdüm. Sınavda çok işe yaradı.',
    name: 'Emre K.',
    role: 'Makine Mühendisliği, Y.Lisans',
    stars: 5,
  },
  {
    quote: 'Almanca kaynaklarla araştırma yapıyorum. Artık sözlüğe gerek kalmıyor, bağlamı da anlıyor.',
    name: 'Selin T.',
    role: 'Hukuk Fakültesi, 3. Sınıf',
    stars: 5,
  },
];

const FEATURES = [
  {
    icon: <Languages size={22} />,
    title: 'Akıllı Dil Tespiti',
    desc: 'İngilizce, Almanca, Arapça, Çince dahil 12 dili otomatik tanır. Siz sadece yükleyin.',
  },
  {
    icon: <FileText size={22} />,
    title: '150+ Sayfa Desteği',
    desc: 'Tek seferde 150 sayfaya kadar belge. Akademik makaleler, kitap bölümleri, raporlar.',
  },
  {
    icon: <BookOpen size={22} />,
    title: 'Ders Notu Çıkar',
    desc: 'Slayt veya fotoğraf yükle, AI organize ders notu oluşturur. Sınav hazırlığı kolaylaşır.',
  },
  {
    icon: <Brain size={22} />,
    title: 'AI Soru-Cevap',
    desc: 'Çevirdiğin belgeye soru sor. Akademik bağlamı anlayan anlık cevaplar alırsın.',
  },
  {
    icon: <FileType size={22} />,
    title: 'PDF · Word · TXT',
    desc: 'Çevirinizi PDF, Word veya düz metin olarak indirin. Profesyonel formatlama dahil.',
  },
  {
    icon: <Shield size={22} />,
    title: 'Güvenli & Özel',
    desc: '256-bit şifreleme. Belgeleriniz üçüncü taraflarla asla paylaşılmaz.',
  },
];

/* ── Live demo copy ───────────────────────────────────────── */
const DEMO_SOURCE = `This study comprehensively examines neuroplasticity and its effects on cognitive learning processes. Research findings suggest that early interventions yield significant long-term cognitive benefits.

Methods employed include longitudinal observation, cognitive mapping, and comparative analysis across demographic variables.`;

const DEMO_TR = `Bu çalışmada nöroplastisite kavramı ve bilişsel öğrenme süreçleri üzerindeki etkileri kapsamlı biçimde incelenmiştir. Araştırma bulguları, erken dönem müdahalelerin uzun vadeli bilişsel faydalar sağladığını ortaya koymaktadır.

Kullanılan yöntemler arasında boylamsal gözlem, bilişsel haritalama ve karşılaştırmalı analiz yer almaktadır.`;

type LivePhase = 'idle' | 'analyzing' | 'translating' | 'complete';

/* ════════════════════════════════════════════════════════════ */
export default function LandingPage() {
  const reduced = useReducedMotion();

  /* ── Live demo state ── */
  const [livePhase, setLivePhase] = useState<LivePhase>('idle');
  const [liveProgress, setLiveProgress] = useState(0);
  const [liveStreamed, setLiveStreamed] = useState('');
  const [livePage, setLivePage] = useState(1);

  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyzeRef  = useRef<ReturnType<typeof setTimeout>  | null>(null);

  const clearTimers = useCallback(() => {
    if (progressRef.current) clearInterval(progressRef.current);
    if (streamRef.current)   clearInterval(streamRef.current);
    if (analyzeRef.current)  clearTimeout(analyzeRef.current);
  }, []);

  const resetDemo = useCallback(() => {
    clearTimers();
    setLivePhase('idle');
    setLiveProgress(0);
    setLiveStreamed('');
    setLivePage(1);
  }, [clearTimers]);

  const startDemo = useCallback(() => {
    if (livePhase !== 'idle') return;
    clearTimers();
    setLivePhase('analyzing');
    setLiveProgress(0);
    setLiveStreamed('');
    setLivePage(1);

    analyzeRef.current = setTimeout(() => {
      setLivePhase('translating');

      /* Progress: 0→100 in ~3 s */
      let prog = 0;
      progressRef.current = setInterval(() => {
        prog += 1;
        setLiveProgress(prog);
        setLivePage(Math.min(Math.ceil(prog / 12.5), 8));
        if (prog >= 100) clearInterval(progressRef.current!);
      }, 30);

      /* Stream text */
      let idx = 0;
      streamRef.current = setInterval(() => {
        idx += 5;
        if (idx <= DEMO_TR.length) {
          setLiveStreamed(DEMO_TR.slice(0, idx));
        } else {
          clearInterval(streamRef.current!);
          setLiveStreamed(DEMO_TR);
          setTimeout(() => setLivePhase('complete'), 300);
        }
      }, 22);
    }, 850);
  }, [livePhase, clearTimers]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  /* ── Old step demo (kept for backwards compat, hidden now) ── */
  const [demoStep, setDemoStep] = useState(0);
  const [demoAuto, setDemoAuto] = useState(true);
  useEffect(() => {
    if (!demoAuto) return;
    const t = setInterval(() => setDemoStep(s => (s + 1) % 3), 3800);
    return () => clearInterval(t);
  }, [demoAuto]);

  return (
    <div className={styles.page}>

      {/* ══════════════════════════════════════════════════════
          HERO
      ══════════════════════════════════════════════════════ */}
      <section className={styles.hero}>
        <div className={styles.heroBg} aria-hidden="true" />

        <div className={styles.heroContent}>
          <motion.div
            className={styles.heroBadge}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <span className={styles.heroBadgeDot} />
            Öğrenciler ve Araştırmacılar için AI
          </motion.div>

          <motion.h1
            className={styles.heroTitle}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.08, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            Yabancı Kaynakları<br />
            <span className={styles.heroTitleAccent}>Saniyeler İçinde</span> Anla
          </motion.h1>

          <motion.p
            className={styles.heroSubtitle}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.18 }}
          >
            Akademik makaleler, ders kitapları ve araştırma raporlarını 12 dilden Türkçe'ye çevirin.
            Ders notu çıkarın, AI'a soru sorun. Dakikalar içinde.
          </motion.p>

          <motion.div
            className={styles.heroCtas}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.28 }}
          >
            <Magnetic strength={0.14}>
              <motion.div whileTap={reduced ? undefined : { scale: 0.97 }}>
                <Link to="/auth?mode=register" className={styles.ctaPrimary}>
                  Ücretsiz Başla
                  <motion.span style={{ display: 'inline-flex' }}
                    whileHover={reduced ? undefined : { x: 3 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 22 }}
                  >
                    <ArrowRight size={16} />
                  </motion.span>
                </Link>
              </motion.div>
            </Magnetic>
            <motion.a
              href="#how-it-works"
              className={styles.ctaSecondary}
              onClick={scrollTo('how-it-works')}
              whileHover={reduced ? undefined : { y: -1 }}
              whileTap={reduced ? undefined : { scale: 0.97 }}
            >
              Canlı Demoyu Dene
            </motion.a>
          </motion.div>
        </div>

        {/* Product mockup */}
        <motion.div
          className={styles.heroMockup}
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.38, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          <div className={styles.mockupWindow}>
            <div className={styles.mockupBar}>
              <div className={styles.mockupDots}>
                <span /><span /><span />
              </div>
              <div className={styles.mockupUrl}>translingua.app/translate</div>
              <div className={styles.mockupActions}>
                <div className={styles.mockupActionBtn} />
                <div className={styles.mockupActionBtn} />
              </div>
            </div>
            <div className={styles.mockupBody}>
              {/* Left pane */}
              <div className={styles.mockupPane}>
                <div className={styles.mockupPaneHeader}>
                  <div className={styles.mockupPaneLang}>EN</div>
                  <div className={styles.mockupPaneFile}>
                    <FileText size={11} />
                    neuroplasticity_en.pdf
                  </div>
                </div>
                <p className={styles.mockupPaneText}>
                  "This study comprehensively examines neuroplasticity and its effects on cognitive learning processes. Research findings suggest that early interventions yield significant long-term cognitive benefits..."
                </p>
              </div>
              {/* Divider */}
              <div className={styles.mockupPaneDivider} />
              {/* Right pane */}
              <div className={styles.mockupPane}>
                <div className={styles.mockupPaneHeader}>
                  <div className={`${styles.mockupPaneLang} ${styles.mockupPaneLangTR}`}>TR</div>
                  <div className={styles.mockupPaneBadge}>
                    <Check size={10} />
                    Tamamlandı
                  </div>
                </div>
                <p className={`${styles.mockupPaneText} ${styles.mockupPaneTextTR}`}>
                  "Bu çalışmada nöroplastisite ve bilişsel öğrenme süreçleri kapsamlı biçimde incelenmiştir. Bulgular, erken müdahalelerin uzun vadeli bilişsel faydalar sağladığını göstermektedir..."
                </p>
                <div className={styles.mockupDownloads}>
                  <button className={styles.mockupDlBtn}><FileText size={10} /> PDF</button>
                  <button className={styles.mockupDlBtn}><FileType size={10} /> Word</button>
                  <button className={styles.mockupDlBtn}><FileCode size={10} /> TXT</button>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </section>

      {/* ── Stats strip ── */}
      <motion.div
        className={styles.statsStrip}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.6 }}
      >
        {[
          { num: '12+',    label: 'Kaynak Dil' },
          { num: '150+',   label: 'Sayfa Kapasitesi' },
          { num: '3',      label: 'Export Formatı' },
          { num: '256-bit', label: 'Şifreleme' },
        ].map(s => (
          <div key={s.label} className={styles.statItem}>
            <div className={styles.statNum}>{s.num}</div>
            <div className={styles.statLabel}>{s.label}</div>
          </div>
        ))}
      </motion.div>

      {/* ══════════════════════════════════════════════════════
          FEATURES
      ══════════════════════════════════════════════════════ */}
      <section className={styles.featuresSection} id="features">
        <div className={styles.sectionHeader}>
          <span className={styles.sectionLabel}>Özellikler</span>
          <h2 className={styles.sectionTitle}>Akademik çalışmana özel araçlar</h2>
          <p className={styles.sectionDesc}>
            Tek platformda çeviri, not çıkarma ve kaynak analizi — ayrı araçlara gerek yok.
          </p>
        </div>

        <div className={styles.featuresGrid}>
          {FEATURES.map((f, i) => (
            <motion.div
              key={i}
              className={styles.featureCard}
              variants={fadeUp}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              custom={i}
              whileHover={reduced ? undefined : { y: -3 }}
              transition={{ type: 'spring', stiffness: 400, damping: 28 }}
            >
              <div className={styles.featureIconWrap}>{f.icon}</div>
              <h3 className={styles.featureTitle}>{f.title}</h3>
              <p className={styles.featureDesc}>{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════
          LIVE DEMO
      ══════════════════════════════════════════════════════ */}
      <section className={styles.liveDemoSection} id="how-it-works">
        <div className={styles.sectionHeader}>
          <span className={styles.sectionLabel}>Nasıl Çalışır</span>
          <h2 className={styles.sectionTitle}>Canlı demoyu kendiniz deneyin</h2>
          <p className={styles.sectionDesc}>
            Gerçek bir çeviri simülasyonu — "Çevir" butonuna tıklayın ve izleyin.
          </p>
        </div>

        <motion.div
          className={styles.liveBox}
          initial={{ opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.65, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          {/* Window chrome */}
          <div className={styles.liveBoxBar}>
            <div className={styles.liveBoxDots}>
              <span /><span /><span />
            </div>
            <span className={styles.liveBoxUrl}>translingua.app/translate</span>
            <div className={styles.liveBoxBadge}>
              <motion.span
                className={styles.liveBoxBadgeDot}
                animate={{ opacity: livePhase !== 'idle' ? [1, 0.3, 1] : 1 }}
                transition={{ duration: 1, repeat: Infinity }}
              />
              Canlı Demo
            </div>
          </div>

          <div className={styles.liveInterface}>
            {/* ── Left control panel ── */}
            <div className={styles.liveLeft}>
              {/* File card */}
              <div className={styles.liveFileCard}>
                <div className={`${styles.liveFileIcon} ${livePhase === 'complete' ? styles.liveFileIconDone : ''}`}>
                  {livePhase === 'complete' ? <Check size={18} /> : <FileText size={18} />}
                </div>
                <div className={styles.liveFileInfo}>
                  <div className={styles.liveFileName}>neuroplasticity_en.pdf</div>
                  <div className={styles.liveFileMeta}>8 sayfa · 2.3 MB · İngilizce</div>
                </div>
              </div>

              {/* Language row */}
              <div className={styles.liveLangRow}>
                <div className={styles.liveLangChip}>
                  <Globe size={12} />
                  English
                </div>
                <ArrowRight size={13} className={styles.liveLangArrow} />
                <div className={`${styles.liveLangChip} ${styles.liveLangChipTR}`}>
                  Türkçe
                </div>
              </div>

              {/* Progress */}
              <AP mode="wait">
                {livePhase === 'translating' && (
                  <motion.div
                    className={styles.liveProgressArea}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <div className={styles.liveProgressMeta}>
                      <span>Sayfa {livePage} / 8 işleniyor</span>
                      <span className={styles.liveProgressPct}>{Math.round(liveProgress)}%</span>
                    </div>
                    <div className={styles.liveProgressTrack}>
                      <motion.div
                        className={styles.liveProgressFill}
                        animate={{ width: `${liveProgress}%` }}
                        transition={{ duration: 0.08 }}
                      />
                    </div>
                  </motion.div>
                )}
                {livePhase === 'complete' && (
                  <motion.div
                    className={styles.liveCompleteBadge}
                    initial={{ opacity: 0, scale: 0.92 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 28 }}
                  >
                    <Check size={13} />
                    Tamamlandı — 8 sayfa, ~1.8 dakika
                  </motion.div>
                )}
              </AP>

              {/* Credit note */}
              <div className={styles.liveCreditNote}>
                <Zap size={11} />
                8 kredi kullanılacak
              </div>

              {/* CTA button */}
              <Magnetic strength={0.1}>
                <motion.button
                  className={`${styles.liveBtn} ${
                    livePhase === 'analyzing' || livePhase === 'translating'
                      ? styles.liveBtnBusy
                      : livePhase === 'complete'
                      ? styles.liveBtnReset
                      : styles.liveBtnActive
                  }`}
                  onClick={livePhase === 'complete' ? resetDemo : startDemo}
                  disabled={livePhase === 'analyzing' || livePhase === 'translating'}
                  whileTap={{ scale: 0.97 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 28 }}
                >
                  {livePhase === 'idle' && (
                    <><Zap size={15} /> Çevir</>
                  )}
                  {(livePhase === 'analyzing' || livePhase === 'translating') && (
                    <><Loader size={15} className={styles.spinIcon} /> İşleniyor...</>
                  )}
                  {livePhase === 'complete' && (
                    <><RotateCcw size={15} /> Tekrar Dene</>
                  )}
                </motion.button>
              </Magnetic>

              {/* Download buttons */}
              <AP>
                {livePhase === 'complete' && (
                  <motion.div
                    className={styles.liveDlRow}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1, duration: 0.3 }}
                  >
                    <button className={styles.liveDlBtn}><FileText size={12} /> PDF</button>
                    <button className={styles.liveDlBtn}><FileType size={12} /> Word</button>
                    <button className={styles.liveDlBtn}><FileCode size={12} /> TXT</button>
                  </motion.div>
                )}
              </AP>
            </div>

            {/* ── Divider ── */}
            <div className={styles.liveDivider} />

            {/* ── Right result panel ── */}
            <div className={styles.liveRight}>
              <div className={styles.liveRightHeader}>
                <span className={styles.liveRightTitle}>Türkçe Çeviri</span>
                <AP>
                  {livePhase === 'complete' && (
                    <motion.span
                      className={styles.liveVerifiedBadge}
                      initial={{ opacity: 0, scale: 0.85 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 28 }}
                    >
                      <Check size={11} /> AI Onaylı
                    </motion.span>
                  )}
                </AP>
              </div>

              <AP mode="wait">
                {livePhase === 'idle' && (
                  <motion.div
                    key="idle"
                    className={styles.liveEmptyState}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <Languages size={28} className={styles.liveEmptyIcon} />
                    <p className={styles.liveEmptyTitle}>Çeviri burada görünecek</p>
                    <p className={styles.liveEmptyHint}>← Sol paneldeki "Çevir" butonuna tıklayın</p>
                  </motion.div>
                )}

                {livePhase === 'analyzing' && (
                  <motion.div
                    key="analyzing"
                    className={styles.liveAnalyzingState}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <div className={styles.liveAnalyzingDots}>
                      {[0, 1, 2].map(i => (
                        <motion.span
                          key={i}
                          className={styles.liveAnalyzingDot}
                          animate={{ y: [0, -6, 0], opacity: [0.3, 1, 0.3] }}
                          transition={{ duration: 0.8, delay: i * 0.15, repeat: Infinity }}
                        />
                      ))}
                    </div>
                    <p className={styles.liveAnalyzingText}>Belge yapısı analiz ediliyor...</p>
                  </motion.div>
                )}

                {(livePhase === 'translating' || livePhase === 'complete') && (
                  <motion.div
                    key="translating"
                    className={styles.liveTextOutput}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                  >
                    {liveStreamed}
                    {livePhase === 'translating' && (
                      <motion.span
                        className={styles.liveCursor}
                        animate={{ opacity: [1, 0] }}
                        transition={{ duration: 0.5, repeat: Infinity, repeatType: 'reverse' }}
                      />
                    )}
                  </motion.div>
                )}
              </AP>
            </div>
          </div>
        </motion.div>

        {/* Steps below */}
        <div className={styles.liveSteps}>
          {[
            { num: '01', icon: <FileText size={18} />, title: 'Yükle', desc: 'PDF, Word, görsel veya slayt' },
            { num: '02', icon: <Brain size={18} />, title: 'AI Çevirir', desc: 'Akademik terminolojiyle bilinçli çeviri' },
            { num: '03', icon: <FileType size={18} />, title: 'İndir', desc: 'PDF, Word veya TXT olarak dışa aktar' },
          ].map((s, i) => (
            <motion.div
              key={s.num}
              className={styles.liveStep}
              variants={fadeUp}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              custom={i}
            >
              <div className={styles.liveStepIcon}>{s.icon}</div>
              <div className={styles.liveStepNum}>{s.num}</div>
              <div className={styles.liveStepTitle}>{s.title}</div>
              <div className={styles.liveStepDesc}>{s.desc}</div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════
          TESTIMONIALS
      ══════════════════════════════════════════════════════ */}
      <section className={styles.testimonialsSection}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionLabel}>Kullanıcı Yorumları</span>
          <h2 className={styles.sectionTitle}>Öğrenciler ne diyor?</h2>
        </div>
        <div className={styles.testimonialsGrid}>
          {TESTIMONIALS.map((t, i) => (
            <motion.div
              key={i}
              className={styles.testimonialCard}
              variants={fadeUp}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              custom={i}
              whileHover={reduced ? undefined : { y: -3 }}
              transition={{ type: 'spring', stiffness: 400, damping: 28 }}
            >
              <div className={styles.testimonialStars}>
                {Array.from({ length: t.stars }).map((_, si) => (
                  <Star key={si} size={13} fill="currentColor" />
                ))}
              </div>
              <p className={styles.testimonialText}>"{t.quote}"</p>
              <div className={styles.testimonialAuthor}>
                <div className={styles.testimonialAvatar}>{t.name[0]}</div>
                <div>
                  <div className={styles.testimonialName}>{t.name}</div>
                  <div className={styles.testimonialRole}>{t.role}</div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════
          PRICING
      ══════════════════════════════════════════════════════ */}
      <section className={styles.pricingSection} id="pricing">
        <div className={styles.sectionHeader}>
          <span className={styles.sectionLabel}>Fiyatlandırma</span>
          <h2 className={styles.sectionTitle}>İhtiyacınıza uygun plan</h2>
          <p className={styles.sectionDesc}>
            Ücretsiz başlayın. Kredi asla boşa gitmez.
          </p>
        </div>

        <motion.div
          className={styles.creditExplainer}
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4 }}
        >
          {[
            { icon: <Languages size={13} />, text: '1 sayfa çeviri = 1 kredi' },
            { icon: <BookOpen size={13} />, text: '1 ders notu kaynağı = 1 kredi' },
            { icon: <MessageSquare size={13} />, text: 'AI soru = 0.5 kredi' },
          ].map((item, i) => (
            <div key={i} className={styles.creditPill}>
              {item.icon}<span>{item.text}</span>
            </div>
          ))}
        </motion.div>

        <div className={styles.pricingGrid}>
          {PRICING_PLANS.map((plan, i) => (
            <motion.div
              key={plan.id}
              className={`${styles.pricingCard} ${plan.popular ? styles.pricingCardPopular : ''}`}
              variants={fadeUp}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              custom={i}
              whileHover={reduced ? undefined : { y: -4 }}
              transition={{ type: 'spring', stiffness: 360, damping: 26 }}
            >
              {plan.popular && (
                <div className={styles.popularBadge}>
                  <Zap size={9} /> En Çok Tercih
                </div>
              )}
              <div className={styles.pricingName}>{plan.name}</div>
              <div className={styles.pricingPrice}>
                {plan.priceLabel}
                {plan.price > 0 && <span className={styles.pricingPer}>/ay</span>}
              </div>
              {plan.credits > 0 && (
                <div className={styles.pricingCredits}>{plan.credits} kredi/ay</div>
              )}
              <ul className={styles.pricingFeatureList}>
                {plan.features.map((f, fi) => (
                  <li key={fi}><Check size={13} />{f}</li>
                ))}
              </ul>
              <Link
                to="/auth?mode=register"
                className={`${styles.pricingCta} ${plan.popular ? styles.pricingCtaPrimary : ''}`}
              >
                {plan.price === 0 ? 'Ücretsiz Başla' : plan.price === -1 ? 'İletişime Geçin' : 'Plan Seç'}
              </Link>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════
          CTA BAND
      ══════════════════════════════════════════════════════ */}
      <section className={styles.ctaBand}>
        <motion.div
          className={styles.ctaBandInner}
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.55 }}
        >
          <h2 className={styles.ctaBandTitle}>Bir dahaki ödevinizden önce deneyin</h2>
          <p className={styles.ctaBandSub}>Kayıt ücretsiz. Kredi kartı gerekmez.</p>
          <Magnetic strength={0.12}>
            <motion.div whileTap={reduced ? undefined : { scale: 0.97 }}>
              <Link to="/auth?mode=register" className={styles.ctaPrimary} style={{ padding: '14px 36px', fontSize: '15px' }}>
                Ücretsiz Hesap Aç
                <motion.span style={{ display: 'inline-flex' }}
                  whileHover={reduced ? undefined : { x: 3 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 22 }}
                >
                  <ArrowRight size={17} />
                </motion.span>
              </Link>
            </motion.div>
          </Magnetic>
        </motion.div>
      </section>

      {/* ══════════════════════════════════════════════════════
          FOOTER
      ══════════════════════════════════════════════════════ */}
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div className={styles.footerBrand}>
            <div className={styles.footerLogo}>TL</div>
            <span className={styles.footerBrandName}>TransLingua</span>
          </div>
          <nav className={styles.footerLinks}>
            <a href="#features"  onClick={scrollTo('features')}>Özellikler</a>
            <a href="#pricing"   onClick={scrollTo('pricing')}>Fiyatlar</a>
            <a href="#how-it-works" onClick={scrollTo('how-it-works')}>Nasıl Çalışır</a>
            <Link to="/auth">Giriş Yap</Link>
          </nav>
          <p className={styles.footerCopy}>© {new Date().getFullYear()} TransLingua</p>
        </div>
      </footer>
    </div>
  );
}
