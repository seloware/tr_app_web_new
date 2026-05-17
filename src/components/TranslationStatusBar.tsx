/**
 * Global çeviri durum çubuğu — tüm sayfalarda görünür.
 * - İş yoksa: hiçbir şey render etmez.
 * - İş varsa: ekranın alt sağında compact bir kart gösterir; tıklanırsa Translator sayfasına götürür.
 */
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Languages, X, Check, AlertCircle, Loader, Download } from 'lucide-react';
import { useTranslationJob } from '../context/TranslationContext';

export default function TranslationStatusBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { job, dismiss, downloadResult } = useTranslationJob();

  if (!job) return null;
  // Translator sayfasında zaten kart var; duplicate olmasın
  if (location.pathname === '/translate') return null;

  const isRunning = job.status === 'running';
  const isDone = job.status === 'completed';
  const isError = job.status === 'error' || job.status === 'cancelled';

  return (
    <AnimatePresence>
      {job && (
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          style={{
            position: 'fixed',
            bottom: 20,
            right: 20,
            zIndex: 200,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 14,
            boxShadow: 'var(--shadow-lg, 0 10px 30px rgba(0,0,0,0.12))',
            padding: '12px 14px',
            minWidth: 280,
            maxWidth: 360,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            fontFamily: 'var(--font-family)',
            color: 'var(--color-text-primary)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 34, height: 34, borderRadius: 10,
                display: 'grid', placeItems: 'center',
                background: isDone ? 'var(--color-success-bg)' :
                  isError ? 'var(--color-error-bg)' : 'var(--color-accent-light)',
                color: isDone ? 'var(--color-success)' :
                  isError ? 'var(--color-error)' : 'var(--color-accent)',
                flexShrink: 0,
              }}
            >
              {isDone ? <Check size={16} /> :
                isError ? <AlertCircle size={16} /> :
                  <Loader size={16} style={{ animation: 'spin 0.9s linear infinite' }} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 13, fontWeight: 600,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {job.fileName}
              </div>
              <div style={{
                fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 2,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {isRunning ? `${job.message} • ${job.progress}%` :
                  isDone ? 'Çeviri tamamlandı' :
                    job.errorMessage || job.message}
              </div>
            </div>
            {!isRunning && (
              <button
                onClick={dismiss}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--color-text-tertiary)', padding: 4, borderRadius: 6,
                  display: 'grid', placeItems: 'center',
                }}
                aria-label="Kapat"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {isRunning && (
            <div style={{
              height: 4, borderRadius: 2,
              background: 'var(--color-border)', overflow: 'hidden',
            }}>
              <motion.div
                animate={{ width: `${job.progress}%` }}
                transition={{ duration: 0.3 }}
                style={{
                  height: '100%',
                  background: 'linear-gradient(90deg, #0057FF, #0EA5E9)',
                  borderRadius: 2,
                }}
              />
            </div>
          )}

          <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
            {isRunning && (
              <button
                onClick={() => navigate('/translate')}
                style={pillBtn()}
              >
                <Languages size={11} /> Detay
              </button>
            )}
            {isDone && (
              <>
                <button
                  onClick={downloadResult}
                  style={pillBtn(true)}
                >
                  <Download size={11} /> PDF İndir
                </button>
                <button
                  onClick={() => { navigate('/documents'); }}
                  style={pillBtn()}
                >
                  Dokümanlarım
                </button>
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function pillBtn(primary = false): React.CSSProperties {
  return {
    padding: '5px 10px',
    borderRadius: 999,
    border: primary ? 'none' : '1px solid var(--color-border-strong)',
    background: primary ? 'var(--color-accent)' : 'var(--color-surface)',
    color: primary ? 'white' : 'var(--color-text-primary)',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    fontFamily: 'var(--font-family)',
  };
}
