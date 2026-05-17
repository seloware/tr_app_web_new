/**
 * TranslationContext — Arka plan çeviri yöneticisi
 *
 * Aynı anda 1 aktif çeviri tutar; kullanıcı sayfayı değiştirse bile iş devam eder.
 * UI'a iki yerden bağlanır:
 *   1) TranslatorPage: aktif iş varsa progress kartı gösterir
 *   2) Navbar mini-rozet: tüm sayfalarda ilerleme yüzdesi gösterir
 *
 * İş tamamlandığında:
 *   - toast.success çağrılır
 *   - tarayıcı bildirimi gönderilir (sayfa gizliyse)
 *   - localStorage'a son sonuç yazılır (sekme kapatılırsa kayıp olmasın)
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import toast from 'react-hot-toast';
import { translatePDF, type TranslationProgress } from '../lib/pdfTranslator';
import { buildTranslatedPDF, downloadBytes } from '../lib/pdfWriter';
import { supabase } from '../lib/supabase';
import { detectLanguage } from '../lib/ai';
import { notify, requestPermission } from '../lib/notifications';
import { TARGET_LANGUAGE } from '../lib/constants';
import * as pdfjsLib from 'pdfjs-dist';
import type { OverlayData, OverlayPage } from '../types';

pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

export type JobMode = 'foreground' | 'background';
export type JobStatus = 'idle' | 'running' | 'completed' | 'error' | 'cancelled';

export interface ActiveJob {
  id: string;
  fileName: string;
  fileSize: number;
  status: JobStatus;
  mode: JobMode;
  progress: number;       // 0-100 (toplam)
  phase: TranslationProgress['phase'] | 'uploading' | 'saving';
  message: string;
  detail?: string;
  etaSeconds?: number;
  pageStatuses?: Uint8Array;
  totalPages: number;
  completedPages: number;
  docId?: string;
  overlay?: OverlayData;
  errorMessage?: string;
  startedAt: number;
  completedAt?: number;
}

interface StartParams {
  file: File;
  sourceLang: string; // 'auto' veya iso kodu
  userId: string;
  credits: number;
  mode: JobMode;
}

interface Ctx {
  job: ActiveJob | null;
  start: (p: StartParams) => Promise<void>;
  cancel: () => void;
  setMode: (mode: JobMode) => void;
  dismiss: () => void;
  /** Tamamlanmış işin sonucunu indirir (PDF) */
  downloadResult: () => Promise<void>;
}

const TranslationCtx = createContext<Ctx | null>(null);

export function useTranslationJob(): Ctx {
  const c = useContext(TranslationCtx);
  if (!c) throw new Error('useTranslationJob must be used inside TranslationProvider');
  return c;
}

export function TranslationProvider({ children }: { children: ReactNode }) {
  const [job, setJob] = useState<ActiveJob | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<File | null>(null);
  const overlayRef = useRef<OverlayPage[] | null>(null);

  // Sayfa kapatma uyarısı — foreground modunda iş devam ediyorsa
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (job?.status === 'running' && job.mode === 'foreground') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [job?.status, job?.mode]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setJob(prev => prev ? { ...prev, status: 'cancelled', message: 'İptal edildi' } : null);
    toast('Çeviri iptal edildi', { icon: '⊘' });
  }, []);

  const setMode = useCallback((mode: JobMode) => {
    setJob(prev => prev ? { ...prev, mode } : null);
    if (mode === 'background') {
      toast('Çeviri arka planda devam ediyor — istediğiniz sayfaya gidebilirsiniz.', {
        icon: '↗',
        duration: 4500,
      });
    }
  }, []);

  const dismiss = useCallback(() => {
    if (job?.status === 'running') return;
    setJob(null);
    fileRef.current = null;
    overlayRef.current = null;
  }, [job?.status]);

  const downloadResult = useCallback(async () => {
    if (!job || job.status !== 'completed' || !overlayRef.current) {
      toast.error('İndirilebilir sonuç yok.');
      return;
    }
    const t = toast.loading('PDF hazırlanıyor…');
    try {
      let source: File | ArrayBuffer;
      if (fileRef.current) {
        source = fileRef.current;
      } else if (job.docId) {
        // dosya artık bellekte yok → storage'dan çek
        const { data: doc } = await supabase.from('documents').select('original_storage_path').eq('id', job.docId).single();
        if (!doc?.original_storage_path) throw new Error('Orijinal PDF bulunamadı');
        const { data: signed } = await supabase.storage.from('originals').createSignedUrl(doc.original_storage_path, 600);
        if (!signed?.signedUrl) throw new Error('İndirme linki alınamadı');
        const res = await fetch(signed.signedUrl);
        source = await res.arrayBuffer();
      } else {
        throw new Error('Orijinal PDF bulunamadı');
      }

      const bytes = await buildTranslatedPDF({
        originalPDF: source,
        pages: overlayRef.current,
      });
      const safe = job.fileName.replace(/\.pdf$/i, '').replace(/[^\w\d-_]+/g, '_');
      downloadBytes(bytes, `${safe}_TR.pdf`);
      toast.success('PDF indirildi', { id: t });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'İndirme başarısız';
      toast.error(msg, { id: t });
    }
  }, [job]);

  const start = useCallback(async ({ file, sourceLang, userId, credits, mode }: StartParams) => {
    if (job?.status === 'running') {
      toast.error('Zaten bir çeviri çalışıyor. Önce mevcutu bitirin veya iptal edin.');
      return;
    }

    // Bildirim izni iste (arka plan modu için kritik)
    void requestPermission();

    const id = crypto.randomUUID();
    fileRef.current = file;
    overlayRef.current = null;

    const initial: ActiveJob = {
      id,
      fileName: file.name,
      fileSize: file.size,
      status: 'running',
      mode,
      progress: 0,
      phase: 'uploading',
      message: 'Dosya yükleniyor…',
      totalPages: 0,
      completedPages: 0,
      startedAt: Date.now(),
    };
    setJob(initial);

    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    try {
      // ── Adım 1: Supabase Storage'a yükle ──────────────────────────────────
      const filePath = `${userId}/${Date.now()}_${file.name}`;
      setJob(j => j && { ...j, progress: 5, phase: 'uploading', message: 'Dosya buluta yükleniyor…', detail: file.name });
      const { error: upErr } = await supabase.storage.from('originals').upload(filePath, file);
      if (upErr) throw new Error('Dosya yüklenemedi: ' + upErr.message);

      // ── Adım 2: Dokuman kaydı oluştur ─────────────────────────────────────
      setJob(j => j && { ...j, progress: 10, message: 'Doküman kaydı oluşturuluyor…' });
      const { data: docData, error: docErr } = await supabase
        .from('documents')
        .insert({
          user_id: userId,
          original_name: file.name,
          original_storage_path: filePath,
          file_size_bytes: file.size,
          status: 'processing',
        })
        .select()
        .single();
      if (docErr) throw new Error('Doküman oluşturulamadı: ' + docErr.message);
      const docId = docData.id;
      setJob(j => j && { ...j, docId });

      // ── Adım 3: Dil tespiti (auto ise) ────────────────────────────────────
      let detectedLang = sourceLang;
      let pageCount = 0;
      try {
        const buf = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
        pageCount = pdf.numPages;
        setJob(j => j && { ...j, totalPages: pageCount });

        if (sourceLang === 'auto') {
          setJob(j => j && { ...j, progress: 15, phase: 'extracting', message: 'Dil tespit ediliyor…' });
          let sample = '';
          for (let p = 1; p <= Math.min(2, pageCount); p++) {
            const page = await pdf.getPage(p);
            const tc = await page.getTextContent();
            sample += tc.items.map((it: unknown) =>
              typeof it === 'object' && it && 'str' in it ? (it as { str: string }).str : ''
            ).join(' ') + ' ';
            if (sample.length > 1200) break;
          }
          detectedLang = sample.trim().length > 20
            ? await detectLanguage(sample.slice(0, 800))
            : 'en';
          setJob(j => j && { ...j, detail: `Dil: ${detectedLang.toUpperCase()}` });
        }
      } catch (e) {
        throw new Error('PDF okunamadı: ' + (e instanceof Error ? e.message : 'bilinmeyen hata'));
      }

      await supabase.from('documents').update({ page_count: pageCount }).eq('id', docId);

      // ── Adım 4: Çeviri pipeline'ı ─────────────────────────────────────────
      const { pages: overlayPages } = await translatePDF(file, {
        sourceLang: detectedLang,
        targetLang: TARGET_LANGUAGE.code,
        signal,
        onProgress: (p) => {
          const pct = 15 + Math.round((p.current / Math.max(1, p.total)) * 75);
          setJob(j => j && {
            ...j,
            progress: Math.min(pct, 90),
            phase: p.phase,
            message: p.message,
            etaSeconds: p.estimatedSecondsLeft,
            completedPages: p.current,
            totalPages: p.total,
            pageStatuses: p.pageStatuses ? new Uint8Array(p.pageStatuses) : undefined,
          });
        },
      });

      overlayRef.current = overlayPages;

      // ── Adım 5: Supabase'e kaydet ─────────────────────────────────────────
      setJob(j => j && { ...j, progress: 92, phase: 'saving', message: 'Çeviri kaydediliyor…' });
      const overlayData: OverlayData = {
        version: 1,
        sourceLang: detectedLang,
        targetLang: TARGET_LANGUAGE.code,
        pages: overlayPages,
      };
      const flatText = overlayPages
        .map(p => [...p.blocks].sort((a, b) => a.y - b.y || a.x - b.x).map(b => b.translated).join('\n'))
        .join('\n\n---\n\n');

      const creditsCost = Math.max(1, pageCount);
      await supabase.from('translations').insert({
        document_id: docId,
        user_id: userId,
        target_language: TARGET_LANGUAGE.code,
        translated_text: { pages: [flatText], overlay: overlayData },
        progress: 100,
        status: 'completed',
        credits_used: creditsCost,
      });
      await supabase.from('documents').update({ status: 'completed', original_language: detectedLang }).eq('id', docId);
      await supabase.from('profiles').update({
        credits_remaining: Math.max(0, credits - creditsCost),
      }).eq('id', userId);

      // ── Tamamlandı ────────────────────────────────────────────────────────
      setJob(j => j && {
        ...j,
        progress: 100,
        status: 'completed',
        phase: 'completed',
        message: 'Çeviri tamamlandı',
        completedAt: Date.now(),
        overlay: overlayData,
      });
      toast.success(`"${file.name}" çevirisi tamamlandı`, { duration: 6000 });
      notify({
        title: 'TransLingua — Çeviri tamamlandı',
        body: `"${file.name}" hazır. PDF olarak indirebilirsiniz.`,
        tag: id,
        onClick: () => {
          window.location.href = '/documents';
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Çeviri başarısız';
      if (msg === 'İptal edildi') {
        setJob(j => j && { ...j, status: 'cancelled', message: msg });
        return;
      }
      setJob(j => j && { ...j, status: 'error', errorMessage: msg, message: msg });
      toast.error(msg, { duration: 6000 });
      notify({
        title: 'TransLingua — Çeviri başarısız',
        body: msg,
        tag: id,
      });
    }
  }, [job?.status]);

  const value = useMemo<Ctx>(() => ({
    job, start, cancel, setMode, dismiss, downloadResult,
  }), [job, start, cancel, setMode, dismiss, downloadResult]);

  return <TranslationCtx.Provider value={value}>{children}</TranslationCtx.Provider>;
}
