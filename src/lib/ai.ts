/**
 * TransLingua — AI Servis Katmanı (v3)
 *
 * Gemini API üzerinden yürütülen tüm AI iş akışları.
 *
 * Özellikler:
 *  • Multimodal input: metin + görsel + PDF (hem sayısal hem taranmış)
 *  • Akıllı PDF modu: küçük/görsel-ağırlıklı PDF'ler doğrudan Gemini'ye gönderilir
 *  • Streaming (SSE) — kullanıcı yanıtı yazılır gibi görür
 *  • Chunk'lı paralel çeviri — 200 sayfa bile sorunsuz
 *  • Multi-turn sohbet geçmişi
 *  • Akademik format korunumu (formül, tablo, dipnot, şekil)
 */

const AI_API_KEY = import.meta.env.VITE_AI_API_KEY as string | undefined;
const AI_API_URL = (import.meta.env.VITE_AI_API_URL as string | undefined) || '';

// Streaming URL: :generateContent → :streamGenerateContent
const STREAM_URL = AI_API_URL.replace(':generateContent', ':streamGenerateContent');

// Pro model URL — çeviri kalitesi için kullanılır
// VITE_AI_PRO_API_URL yoksa flash-lite → pro değiştirilerek türetilir
const AI_PRO_API_URL =
  (import.meta.env.VITE_AI_PRO_API_URL as string | undefined) ||
  AI_API_URL
    .replace('flash-lite-preview', 'pro-preview')
    .replace('flash-lite:', 'pro:')
    .replace('-flash-lite', '-pro');

// Multimodal için boyut sınırı: 15 MB altı PDF'ler doğrudan Gemini'ye gönderilir
const MULTIMODAL_PDF_LIMIT = 15 * 1024 * 1024; // 15 MB

// Metin çıkarma yoğunluğu eşiği: sayfa başına ortalama bu karakterden azsa "görsel ağırlıklı"
const TEXT_DENSITY_THRESHOLD = 80; // karakter / sayfa

// Görsel modda işlenecek maksimum sayfa (üstü metin moduna düşer)
const MAX_VISUAL_PAGES = 40;

// ─── Tipler ─────────────────────────────────────────────────────────────────
export type AIMessageRole = 'user' | 'model';

export interface AIPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

export interface AIMessage {
  role: AIMessageRole;
  parts: AIPart[];
}

interface AIResponseRaw {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
    safetyRatings?: Array<{ category: string; probability: string }>;
  }>;
  error?: { message?: string; code?: number };
  usageMetadata?: { totalTokenCount?: number };
}

function checkFinishReason(reason?: string) {
  if (reason === 'SAFETY') throw new Error('İçerik güvenlik filtresi tarafından engellendi. Farklı bir ifade deneyin.');
  if (reason === 'RECITATION') throw new Error('İçerik alıntı kısıtlamasına takıldı. Lütfen sorguyu değiştirin.');
  if (reason === 'MAX_TOKENS') throw new Error('Yanıt çok uzun kesildi. Soruyu daha kısa parçalara bölün.');
}

export function isAIAvailable(): boolean {
  return !!(AI_API_KEY && AI_API_KEY !== 'YOUR_AI_API_KEY_HERE' && AI_API_URL);
}

// ─── Düşük seviyeli API çağrısı ─────────────────────────────────────────────
interface CallOpts {
  contents: AIMessage[];
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

async function callGemini({
  contents,
  systemInstruction,
  temperature = 0.25,
  maxOutputTokens = 16384,
  _useProModel = false,
}: CallOpts & { _useProModel?: boolean }): Promise<string> {
  if (!isAIAvailable()) return demoResponse(contents);

  const apiUrl = _useProModel ? AI_PRO_API_URL : AI_API_URL;

  const body: Record<string, unknown> = {
    contents,
    generationConfig: { temperature, maxOutputTokens },
  };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  const res = await fetch(`${apiUrl}?key=${AI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => null);
    const msg = errData?.error?.message || `HTTP ${res.status}`;
    // 400 çoğunlukla istek formatı veya model sorunu, 429 rate limit, 503 model yoğunluğu
    if (res.status === 429) throw new Error('AI servis yoğunluğu — birkaç saniye sonra tekrar deneyin.');
    if (res.status === 503) throw new Error('AI servisi geçici olarak kullanılamıyor — lütfen bekleyin.');
    throw new Error(`AI API hatası (${res.status}): ${msg}`);
  }

  const data: AIResponseRaw = await res.json();
  if (data.error) throw new Error(`AI API hatası: ${data.error.message || 'Bilinmeyen hata'}`);

  const candidate = data.candidates?.[0];
  checkFinishReason(candidate?.finishReason);
  const text = candidate?.content?.parts?.map(p => p.text ?? '').join('') ?? '';
  if (!text) throw new Error('Model yanıt üretemedi. Lütfen soruyu farklı bir şekilde deneyin.');
  return text;
}

// ─── Streaming (SSE) ────────────────────────────────────────────────────────
export async function streamGemini(
  opts: CallOpts & {
    onChunk?: (delta: string, full: string) => void;
    signal?: AbortSignal;
  },
): Promise<string> {
  if (!isAIAvailable()) {
    const fake = demoResponse(opts.contents);
    if (opts.onChunk) {
      let buf = '';
      for (const ch of fake) {
        buf += ch;
        opts.onChunk(ch, buf);
        await new Promise(r => setTimeout(r, 6));
      }
    }
    return fake;
  }

  const body: Record<string, unknown> = {
    contents: opts.contents,
    generationConfig: {
      temperature: opts.temperature ?? 0.25,
      maxOutputTokens: opts.maxOutputTokens ?? 16384,
    },
  };
  if (opts.systemInstruction) {
    body.systemInstruction = { parts: [{ text: opts.systemInstruction }] };
  }

  const url = `${STREAM_URL}?alt=sse&key=${AI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    if (res.status === 429) throw new Error('AI servis yoğunluğu — birkaç saniye sonra tekrar deneyin.');
    if (res.status === 503) throw new Error('AI servisi geçici olarak kullanılamıyor — lütfen bekleyin.');
    const errJson = await res.json().catch(() => null);
    const errMsg = errJson?.error?.message || '';
    throw new Error(`AI stream hatası (${res.status})${errMsg ? ': ' + errMsg : ''}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';

    for (const ev of events) {
      const line = ev.trim();
      if (!line.startsWith('data:')) continue;
      const json = line.slice(5).trim();
      if (json === '[DONE]') continue;
      try {
        const parsed: AIResponseRaw = JSON.parse(json);
        const candidate = parsed.candidates?.[0];
        const piece = candidate?.content?.parts?.map(p => p.text ?? '').join('') ?? '';
        if (piece) {
          full += piece;
          opts.onChunk?.(piece, full);
        }
        // Son chunk'ta finishReason kontrolü
        if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
          checkFinishReason(candidate.finishReason);
        }
      } catch (e) {
        if ((e as Error)?.message?.includes('filtresi') || (e as Error)?.message?.includes('kısıtlama') || (e as Error)?.message?.includes('uzun')) throw e;
        // Yarım JSON — atla
      }
    }
  }

  if (!full) throw new Error('Model yanıt üretemedi. Lütfen soruyu farklı bir şekilde deneyin.');
  return full;
}

// ─── Demo modu ──────────────────────────────────────────────────────────────
function demoResponse(contents: AIMessage[]): string {
  const last = contents[contents.length - 1];
  const txt = last?.parts.map(p => p.text ?? '').join(' ') ?? '';
  return (
    `**Demo Modu** — AI motoru yapılandırılmamış.\n\n` +
    `\`VITE_AI_API_KEY\` ve \`VITE_AI_API_URL\` ortam değişkenleri ayarlandığında ` +
    `gerçek yanıtlar burada görünecek.\n\n` +
    `Gönderilen içerik: "${txt.slice(0, 100).replace(/\n/g, ' ')}..."`
  );
}

// ─── Yardımcılar ────────────────────────────────────────────────────────────
const userText = (text: string): AIMessage => ({ role: 'user', parts: [{ text }] });

/** File → base64 (Gemini inlineData için) */
async function fileToInline(file: File): Promise<{ mimeType: string; data: string }> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return {
    mimeType: file.type || 'application/octet-stream',
    data: btoa(binary),
  };
}

// ─── 1) Akıllı PDF çevirisi ─────────────────────────────────────────────────

/**
 * PDF çevirisi için akıllı mod seçimi:
 *
 * A) Multimodal mod (küçük veya görsel-ağırlıklı PDF):
 *    PDF dosyası doğrudan Gemini'ye gönderilir. Model hem metni hem
 *    görselleri (diyagram, formül, tablo, taranmış sayfa) okur ve çevirir.
 *    Koşul: file.size < 15MB VE metinYoğunluğu < eşik
 *
 * B) Metin chunk modu (büyük veya metin-yoğun PDF):
 *    pdfjs ile çıkarılan metin 10K'lık parçalara bölünür,
 *    4 paralel worker ile çevrilir.
 */
export async function translatePDFSmart(
  file: File,
  extractedText: string,
  pageCount: number,
  opts: TranslateOpts,
): Promise<{ result: string; mode: 'multimodal' | 'text' }> {
  const avgCharsPerPage = pageCount > 0 ? extractedText.length / pageCount : 0;
  const useMultimodal =
    file.size < MULTIMODAL_PDF_LIMIT &&
    avgCharsPerPage < TEXT_DENSITY_THRESHOLD;

  if (useMultimodal) {
    try {
      const result = await translateFileMultimodal(file, opts);
      if (result) return { result, mode: 'multimodal' };
    } catch {
      // Multimodal başarısız (model desteklemiyor / dosya büyük) → metin moduna düş
    }
  }

  // Metin yoğun PDF veya multimodal fallback — chunk çevirisi
  const textToTranslate = extractedText || `PDF dosyası: ${file.name}`;
  const result = await translateLongText(textToTranslate, opts);
  return { result, mode: 'text' };
}

/** Küçük PDF'i doğrudan Gemini multimodal olarak çevir (metin + görsel) */
async function translateFileMultimodal(
  file: File,
  opts: TranslateOpts,
): Promise<string> {
  const { sourceLang, targetLang = 'tr', onProgress, signal } = opts;

  onProgress?.({ chunk: 0, totalChunks: 1, pct: 5 });

  const inline = await fileToInline(file);
  onProgress?.({ chunk: 0, totalChunks: 1, pct: 15 });

  const systemPrompt = buildTranslationSystemPrompt(sourceLang, targetLang);
  const userPrompt =
    `Bu PDF belgesinin TÜMÜNÜ ${targetLang === 'tr' ? 'Türkçeye' : targetLang + ' diline'} çevir.\n` +
    `• Metin içeriğini çevir\n` +
    `• Tablolar varsa Markdown tablosu olarak koru\n` +
    `• Formüller varsa LaTeX notasyonuyla ($ ... $) göster\n` +
    `• Görseller/şekiller için [Şekil N: kısa açıklama] etiketi ekle\n` +
    `• Başlık hiyerarşisini # ## ### ile koru\n` +
    `Sadece çevirilmiş Markdown'ı yaz, başka yorum ekleme.`;

  const contents: AIMessage[] = [{
    role: 'user',
    parts: [{ inlineData: inline }, { text: userPrompt }],
  }];

  let result: string;
  if (onProgress) {
    let lastPct = 15;
    result = await streamGemini({
      contents,
      systemInstruction: systemPrompt,
      maxOutputTokens: 32768,
      signal,
      onChunk: (_delta, full) => {
        // Tahmini ilerleme: çıktı uzunluğuna göre 15→95 arası
        const est = Math.min(95, 15 + Math.floor(full.length / 200));
        if (est > lastPct) {
          lastPct = est;
          onProgress({ chunk: 0, totalChunks: 1, pct: est });
        }
      },
    });
  } else {
    result = await callGemini({
      contents,
      systemInstruction: systemPrompt,
      maxOutputTokens: 32768,
    });
  }

  onProgress?.({ chunk: 1, totalChunks: 1, pct: 100 });
  return result;
}

/** Akademik çeviri için sistem promptu (tüm modlarda ortak) */
function buildTranslationSystemPrompt(sourceLang: string, targetLang: string): string {
  const target = targetLang === 'tr' ? 'Türkçe' : targetLang;
  return `Sen profesyonel bir akademik çevirmensin. Görevin ${sourceLang} dilindeki belgeleri ${target} diline çevirmek.

ÇEVİRİ KURALLARI:
1. Hedef dil: ${target} — doğal, akıcı ve akademik Türkçe kullan
2. Teknik terimler: İlk geçişte orijinal terimi parantez içinde ver (ör: "sinyal iletimi (signal transduction)")
3. Özel isimler, marka adları ve kısaltmalar (DNA, AI, NATO vb.) olduğu gibi bırak
4. Formüller: LaTeX notasyonunu koru ($ ... $ veya $$ ... $$)
5. Tablolar: Markdown tablosu formatını koru
6. Alıntılar / dipnotlar / kaynakça: Format değiştirmeden çevir
7. Şekil/Tablo başlıkları: "Şekil 1:", "Tablo 2:" gibi Türkçe etiketle başlat
8. Bölüm başlıkları: # ## ### Markdown başlık hiyerarşisiyle koru

FORMAT:
- Sadece Markdown çıktı üret
- Hiçbir açıklama, not veya yorum ekleme
- Orijinal yapıyı ve sırayı koru`;
}

// ─── 2) Metin chunk çevirisi (büyük/metin-yoğun PDF'ler) ────────────────────
const CHUNK_SIZE = 10_000; // karakter — ~2.5K token, kalite/hız dengesi
const CONCURRENCY = 4;    // paralel Gemini çağrısı

/** Büyük metni paragraf sınırlarında akıllıca böler */
export function chunkText(text: string, max = CHUNK_SIZE): string[] {
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + max, text.length);
    if (end < text.length) {
      const half = i + max * 0.5;
      const para = text.lastIndexOf('\n\n', end);
      const sent = Math.max(
        text.lastIndexOf('. ', end),
        text.lastIndexOf('? ', end),
        text.lastIndexOf('! ', end),
        text.lastIndexOf('.\n', end),
      );
      const sp = text.lastIndexOf(' ', end);
      end = para > half ? para : sent > half ? sent + 1 : sp > half ? sp : end;
    }
    const chunk = text.slice(i, end).trim();
    if (chunk) chunks.push(chunk);
    i = end;
  }
  return chunks;
}

export interface TranslateOpts {
  sourceLang: string;
  targetLang?: string;
  glossary?: Record<string, string>;
  onProgress?: (info: { chunk: number; totalChunks: number; pct: number }) => void;
  signal?: AbortSignal;
}

/** Uzun metni paralel chunk'larla çevirir — 200 sayfa bile desteklenir */
export async function translateLongText(text: string, opts: TranslateOpts): Promise<string> {
  const { sourceLang, targetLang = 'tr', glossary, onProgress, signal } = opts;
  const chunks = chunkText(text);
  const totalChunks = chunks.length;

  const glossaryStr =
    glossary && Object.keys(glossary).length
      ? `\n\nSabit çeviri sözlüğü (kesinlikle uy):\n${Object.entries(glossary)
          .map(([k, v]) => `- "${k}" → "${v}"`)
          .join('\n')}`
      : '';

  const systemPrompt = buildTranslationSystemPrompt(sourceLang, targetLang) + glossaryStr;

  const results: string[] = new Array(totalChunks);
  let completed = 0;

  async function worker(index: number) {
    if (signal?.aborted) throw new Error('Çeviri iptal edildi.');
    results[index] = await callGemini({
      contents: [userText(chunks[index])],
      systemInstruction: systemPrompt,
      temperature: 0.15,  // çeviri için düşük yaratıcılık = daha tutarlı
      maxOutputTokens: 16384,
    });
    completed++;
    onProgress?.({
      chunk: completed,
      totalChunks,
      pct: Math.round((completed / totalChunks) * 100),
    });
  }

  // Promise havuzu
  const queue = chunks.map((_, i) => i);
  const poolWorker = async () => {
    while (queue.length) {
      const i = queue.shift()!;
      await worker(i);
    }
  };
  const pool: Promise<void>[] = [];
  for (let k = 0; k < Math.min(CONCURRENCY, totalChunks); k++) pool.push(poolWorker());
  await Promise.all(pool);

  return results.join('\n\n');
}

// ─── 2b) Görsel (sayfa-görüntü) tabanlı çeviri ──────────────────────────────

/**
 * Her PDF sayfasını JPEG görüntüsü olarak Gemini Pro'ya gönderir.
 * Grafikler, formüller ve özel semboller görsel olarak korunur.
 * pageDataURLs: pdfRenderer.renderPageToDataURL ile üretilen data URL'ler (JPEG).
 * MAX_VISUAL_PAGES aşılırsa metin moduna düşülmesi için caller yönetir.
 */
export async function translatePDFByPages(
  pageDataURLs: string[],
  opts: TranslateOpts,
): Promise<string[]> {
  const { sourceLang, targetLang = 'tr', onProgress, signal } = opts;
  const total = pageDataURLs.length;
  const results: string[] = new Array(total);
  let completed = 0;

  const systemPrompt = buildTranslationSystemPrompt(sourceLang, targetLang);

  const userPromptTemplate = (lang: string) =>
    `Bu PDF sayfasındaki TÜM metni ${lang === 'tr' ? 'Türkçeye' : lang + ' diline'} çevir.\n` +
    `• Matematiksel formüller: LaTeX notasyonuyla koru ($ ... $ veya $$ ... $$)\n` +
    `• Tablolar: Markdown tablosu formatında koru\n` +
    `• Başlık hiyerarşisini # ## ### ile koru\n` +
    `• Grafik, diyagram veya şekil varsa "[Şekil: kısa açıklama]" etiketi bırak\n` +
    `• Sadece çevirilmiş Markdown çıktısı ver, başka yorum ekleme`;

  async function translatePage(index: number) {
    if (signal?.aborted) throw new Error('Çeviri iptal edildi.');
    const dataURL = pageDataURLs[index];
    const [header, b64] = dataURL.split(',');
    const mimeType = header.match(/:(.*?);/)?.[1] ?? 'image/jpeg';

    const result = await callGemini({
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: b64 } },
          { text: userPromptTemplate(targetLang) },
        ],
      }],
      systemInstruction: systemPrompt,
      temperature: 0.15,
      maxOutputTokens: 8192,
      _useProModel: true,
    });

    results[index] = result;
    completed++;
    onProgress?.({ chunk: completed, totalChunks: total, pct: Math.round((completed / total) * 100) });
  }

  // 4 paralel worker
  const queue = pageDataURLs.map((_, i) => i);
  const poolWorker = async () => {
    while (queue.length) {
      const i = queue.shift()!;
      await translatePage(i);
    }
  };
  const pool: Promise<void>[] = [];
  for (let k = 0; k < Math.min(CONCURRENCY, total); k++) pool.push(poolWorker());
  await Promise.all(pool);

  return results;
}

export { MAX_VISUAL_PAGES };

/** Geriye dönük uyumluluk */
export async function translateDocument(
  text: string,
  sourceLang: string,
  targetLang = 'tr',
): Promise<string> {
  return translateLongText(text, { sourceLang, targetLang });
}

// ─── 3) Dil tespiti ─────────────────────────────────────────────────────────
export async function detectLanguage(text: string): Promise<string> {
  const prompt =
    `Aşağıdaki metnin dilini tespit et. SADECE ISO 639-1 dil kodunu yaz (ör: en, de, fr, ar, zh). ` +
    `Açıklama, noktalama veya başka karakter ekleme.\n\nMetin:\n${text.slice(0, 600)}`;
  try {
    const result = await callGemini({
      contents: [userText(prompt)],
      temperature: 0,
      maxOutputTokens: 8,
    });
    return result.trim().toLowerCase().replace(/[^a-z]/g, '').slice(0, 2);
  } catch {
    return 'en'; // tespit başarısız → varsayılan İngilizce
  }
}

// ─── 4) Multimodal dosya işleme (genel) ─────────────────────────────────────
export async function processFilesMultimodal(
  files: File[],
  prompt: string,
  systemInstruction?: string,
  onChunk?: (delta: string, full: string) => void,
): Promise<string> {
  const inlineParts: AIPart[] = [];
  for (const f of files) {
    inlineParts.push({ inlineData: await fileToInline(f) });
  }
  const contents: AIMessage[] = [{
    role: 'user',
    parts: [...inlineParts, { text: prompt }],
  }];
  if (onChunk) {
    return streamGemini({ contents, systemInstruction, onChunk, maxOutputTokens: 16384 });
  }
  return callGemini({ contents, systemInstruction, maxOutputTokens: 16384 });
}

// ─── 5) AI Sohbet (multi-turn, streaming) ───────────────────────────────────
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  attachments?: { mimeType: string; data: string }[];
}

export async function streamDocumentChat(
  history: ChatTurn[],
  newMessage: string,
  documentText: string | null,
  attachments: File[] = [],
  onChunk?: (delta: string, full: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const systemPrompt =
    `Sen TransLingua'nın öğrenci asistanısın. Akademik sorulara doğrudan, net ve sade yanıt ver.

Kesin kurallar:
- Emoji kullanma. Hiç.
- "Merhaba", "Tabii ki", "Yardımcı olmaktan memnuniyet duyarım" gibi kalıp girişler yapma
- Soruya hemen gir — giriş cümlesi, karşılama veya özet giriş paragrafı yazma
- Markdown kullan ama gereksiz başlık zinciri oluşturma; başlık yalnızca gerçekten bölüm varsa kullan
- Liste yerine düz metin yeterliyse liste yapma
- Konuşma geçmişini hatırla; önceki sorulara referans verebilirsin
- Türkçe yaz`;

  const contents: AIMessage[] = [];

  // Belge bağlamını conversation turn olarak ekle (system instruction değil)
  // Bu yaklaşım tüm Gemini modelleriyle uyumludur
  if (documentText) {
    const truncated = documentText.slice(0, 50_000);
    contents.push({
      role: 'user',
      parts: [{ text: `Aşağıdaki belgeyi analiz et. Soru-cevap sırasında bu belgeyi referans alacaksın:\n\n---\n${truncated}\n---` }],
    });
    contents.push({
      role: 'model',
      parts: [{ text: 'Belgeyi okudum ve analiz ettim. Belge hakkındaki sorularınızı yanıtlamaya hazırım.' }],
    });
  }

  // Konuşma geçmişini ekle
  for (const t of history) {
    contents.push({
      role: t.role === 'assistant' ? ('model' as const) : ('user' as const),
      parts: t.attachments?.length
        ? [...t.attachments.map(a => ({ inlineData: a })), { text: t.content }]
        : [{ text: t.content }],
    });
  }

  // Yeni mesaj + ekler
  const newParts: AIPart[] = [];
  for (const f of attachments) newParts.push({ inlineData: await fileToInline(f) });
  newParts.push({ text: newMessage });
  contents.push({ role: 'user', parts: newParts });

  // Streaming dene; başarısız veya boş yanıt alırsa non-streaming'e düş
  if (onChunk) {
    try {
      const result = await streamGemini({
        contents,
        systemInstruction: systemPrompt,
        maxOutputTokens: 8192,
        onChunk,
        signal,
      });
      if (result) return result;
    } catch (err) {
      const msg = (err as Error)?.message ?? '';
      // Kullanıcı iptali veya kesin hata → yeniden fırlat
      if (
        msg.includes('İptal') || err instanceof DOMException ||
        msg.includes('filtresi') || msg.includes('kısıtlama')
      ) throw err;
      // Diğer stream hataları → non-streaming fallback'e geç
    }
  }

  // Non-streaming fallback (streaming çalışmıyorsa veya boş yanıt geldiyse)
  return callGemini({
    contents,
    systemInstruction: systemPrompt,
    maxOutputTokens: 8192,
  });
}

// ─── Retry yardımcısı ────────────────────────────────────────────────────────

/**
 * Geçici API hatalarında (rate limit, timeout, ağ sorunu) üstel beklemeyle tekrar dener.
 * Abort, güvenlik filtresi ve alıntı hataları yeniden denenmez — hemen fırlatılır.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 2,
  baseDelayMs = 1500,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = (e as Error)?.message ?? '';
      if (
        msg.includes('İptal') || msg.includes('filtresi') ||
        msg.includes('kısıtlama') || e instanceof DOMException
      ) throw e;
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, baseDelayMs * Math.pow(2, attempt)));
      }
    }
  }
  throw lastErr;
}

// ─── 7) Sayfa metin bloklarını konumlu olarak çevir ─────────────────────────

/**
 * Bir PDF sayfasındaki metin bloklarını sıralı olarak çevirir.
 * Bloklar numaralı liste olarak gönderilir, aynı sırada çeviri alınır.
 * Formüller, semboller ve sayılar aynen korunur.
 * Tek API çağrısıyla tüm sayfa işlenir (verimli + bağlam korunur).
 */
export async function translateTextBlocks(
  blocks: string[],
  sourceLang: string,
  targetLang = 'tr',
  signal?: AbortSignal,
): Promise<string[]> {
  if (blocks.length === 0) return [];

  // 60'tan fazla blok varsa gruplara böl
  const BATCH = 60;
  if (blocks.length > BATCH) {
    const results: string[] = [];
    for (let i = 0; i < blocks.length; i += BATCH) {
      const batch = blocks.slice(i, i + BATCH);
      const translated = await translateTextBlocks(batch, sourceLang, targetLang, signal);
      results.push(...translated);
    }
    return results;
  }

  const targetName = targetLang === 'tr' ? 'Türkçe' : targetLang;
  const numbered = blocks.map((b, i) => `${i + 1}. ${b}`).join('\n');

  const result = await callGemini({
    contents: [{
      role: 'user',
      parts: [{ text: `${blocks.length} metin bloğunu ${targetName} diline çevir.\nKurallar:\n- Aynı numarayla, aynı sırayla döndür\n- Matematiksel formüller, özel semboller, sayılar ve kısaltmalar değiştirilmez\n- Sadece numaralı liste yaz, açıklama veya ek yorum ekleme\n\n${numbered}` }],
    }],
    temperature: 0.05,
    maxOutputTokens: 8192,
  });

  // Numaralı çıktıyı parse et
  const out = new Array(blocks.length).fill('');
  for (const line of result.split('\n')) {
    const m = line.match(/^(\d+)\.\s*(.+)/);
    if (m) {
      const idx = parseInt(m[1]) - 1;
      if (idx >= 0 && idx < blocks.length) out[idx] = m[2].trim();
    }
  }

  // Çevirisi alınamayan blokları orijinal metinle doldur
  return out.map((t, i) => t || blocks[i]);
}

// ─── 7b) Sayfa görüntüsü + metin blokları → tüm çeviri (text + visual) ─────

export interface PageVisionTranslation {
  /** PDF.js'ten çıkan blokların çevirisi (aynı sırada) */
  textTranslations: string[];
  /** Grafik/şekil İÇİNDE tespit edilen yeni metinler */
  visualBlocks: Array<{
    x: number; y: number; w: number; h: number;
    fontSize: number; original: string; translated: string;
  }>;
}

/**
 * Sayfanın hem metnini hem GÖRSEL İÇİ yazılarını çevirir.
 *
 * İKİ AŞAMALI yaklaşım (güvenilirlik için):
 *  Faz 1 — Metin çevirisi: translateTextBlocks() ile (görsel gerektirmez, çok güvenilir)
 *  Faz 2 — Görsel metin tespiti: sadece görüntü + JSON çıktı (Gemini JSON'a daha iyi uyar)
 *
 * Faz 2 başarısız olursa çeviri durmuyor — sadece görsel bloklar boş kalır.
 */
export async function translatePageWithVision(
  pageImageDataURL: string,
  textBlocks: Array<{ text: string; x: number; y: number; w: number; h: number; fontSize: number }>,
  sourceLang: string,
  targetLang = 'tr',
  signal?: AbortSignal,
): Promise<PageVisionTranslation> {

  // ── Faz 1: Metin çevirisi (görsel yok, basit numara listesi) ─────────────
  let textTranslations: string[] = textBlocks.map(b => b.text);
  if (textBlocks.length > 0) {
    try {
      textTranslations = await withRetry(
        () => translateTextBlocks(textBlocks.map(b => b.text), sourceLang, targetLang, signal),
        2,
        2000,
      );
    } catch (e) {
      const msg = (e as Error)?.message ?? '';
      if (msg.includes('İptal')) throw e;
      console.warn('Metin çevirisi başarısız — orijinal metin kullanılıyor:', msg);
    }
  }

  if (signal?.aborted) throw new Error('İptal edildi');

  // ── Faz 2: Grafik/görsel içi metin tespiti (best-effort, JSON çıktı) ─────
  const visualBlocks: PageVisionTranslation['visualBlocks'] = [];
  try {
    const detected = await withRetry(
      () => detectVisualTextInPage(pageImageDataURL, sourceLang, targetLang),
      1, // görsel tespit için sadece 1 retry
      2000,
    );
    visualBlocks.push(...detected);
  } catch (e) {
    const msg = (e as Error)?.message ?? '';
    if (msg.includes('İptal')) throw e;
    // Görsel tespit başarısız → önemli değil, devam et
  }

  return { textTranslations, visualBlocks };
}

/**
 * Sayfa görüntüsündeki grafik/diyagram/şekil İÇİNDEKİ metin etiketlerini tespit eder.
 * JSON çıktı formatı kullanır (Gemini JSON'a özel metin formatından çok daha iyi uyar).
 */
async function detectVisualTextInPage(
  pageImageDataURL: string,
  sourceLang: string,
  targetLang: string,
): Promise<PageVisionTranslation['visualBlocks']> {
  const [header, b64] = pageImageDataURL.split(',');
  const mimeType = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
  const targetName = targetLang === 'tr' ? 'Türkçe' : targetLang;

  const prompt =
    `Look at this PDF page. Find text labels that appear INSIDE charts, graphs, diagrams, or figures.\n` +
    `Include: axis labels, legend text, bar/pie labels, diagram annotations, chart titles inside figures.\n` +
    `Exclude: regular paragraph text, section headings, captions below figures, page numbers.\n\n` +
    `Translate each found label from ${sourceLang} to ${targetName}.\n\n` +
    `Return ONLY valid JSON — no markdown, no explanation, nothing else:\n` +
    `{"items":[{"x":0.1,"y":0.3,"w":0.2,"h":0.03,"fs":9,"original":"X Axis","translated":"X Ekseni"}]}\n\n` +
    `Coordinate system: x,y = top-left corner as 0-1 ratio of page size, w = width ratio, h = height ratio.\n` +
    `If no visual text found, return: {"items":[]}`;

  const result = await callGemini({
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType, data: b64 } },
        { text: prompt },
      ],
    }],
    temperature: 0.05,
    maxOutputTokens: 2048,
    _useProModel: true,
  });

  // JSON'u yanıt içinden çıkar (markdown code block olsa bile)
  const jsonMatch = result.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];

  let parsed: { items?: unknown[] };
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return [];
  }

  const items: PageVisionTranslation['visualBlocks'] = [];
  for (const item of (parsed.items ?? [])) {
    if (!item || typeof item !== 'object') continue;
    const { x, y, w, h, fs, original, translated } = item as Record<string, unknown>;
    if (
      typeof x === 'number' && x >= 0 && x <= 1 &&
      typeof y === 'number' && y >= 0 && y <= 1 &&
      typeof w === 'number' && w > 0 && w <= 1 &&
      original && translated
    ) {
      items.push({
        x,
        y,
        w: Math.min(w, 1 - x),
        h: Math.max(typeof h === 'number' ? h : 0.02, 0.01),
        fontSize: typeof fs === 'number' ? fs : 10,
        original: String(original),
        translated: String(translated),
      });
    }
  }
  return items;
}

/**
 * Belgeyi özetle — kısa, madde madde Türkçe özet üretir.
 */
export async function summarizeDocument(
  text: string,
  signal?: AbortSignal,
  onChunk?: (delta: string, full: string) => void,
): Promise<string> {
  const truncated = text.slice(0, 48_000);
  const systemPrompt =
    `Sen bir akademik özet asistanısın. Verilen belgeyi:
• 6-10 maddeli, net ve bilgilendirici Türkçe özetle
• Her madde tek cümle veya kısa paragraf olsun
• Önemli kavramlar, bulgular ve sonuçlara odaklan
• Başlık ekle: ## Özet
• Markdown kullan ama gereksiz iç içe başlık yapma`;

  const contents: AIMessage[] = [{
    role: 'user',
    parts: [{ text: `Şu belgeyi özetle:\n\n${truncated}` }],
  }];

  if (onChunk) {
    return streamGemini({ contents, systemInstruction: systemPrompt, maxOutputTokens: 2048, onChunk, signal });
  }
  return callGemini({ contents, systemInstruction: systemPrompt, maxOutputTokens: 2048 });
}

// ─── 6) Ders Notu Üretimi (multimodal, öğrenci odaklı) ──────────────────────
export async function generateStudyNotes(
  files: File[],
  subject?: string,
  _title?: string,
  onChunk?: (delta: string, full: string) => void,
): Promise<string> {
  const subjectLine = subject ? `Ders/Konu: **${subject}**` : '';

  const systemPrompt =
    `Sen deneyimli bir eğitim asistanısın ve üniversite/lise öğrencileri için ders notu hazırlıyorsun.
${subjectLine}

MATERYALİ ANLAMA:
• Tahta fotoğrafı, slayt, kitap sayfası, el yazısı veya PDF olabilir
• Tüm metni, formülleri, şemaları, diyagramları ve tabloları oku
• El yazısı varsa dikkatle deşifre et
• Formülleri LaTeX notasyonuyla yaz ($ ... $)

DERS NOTU FORMATI (Markdown):
# [Konu Başlığı]

## Temel Kavramlar
- Her kavramı madde halinde açıkla
- **Kalın** ile anahtar terimleri vurgula
- Gerekirse alt maddelerle detaylandır

## Formüller ve Tanımlar
| Sembol | Açıklama |
|--------|----------|
| ... | ... |

$$formül$$

## Konu Anlatımı
- Konuyu adım adım, örnek vererek açıkla
- Sezgisel açıklamalar ekle ("Bunu şöyle düşünebilirsiniz...")

## Önemli Noktalar
> Ezber edilmesi gereken kritik bilgiler burada

## Özet
5-7 maddede konunun özeti

## Pratik Sorular
Her soru için:
**S:** Soru metni
**C:** Cevap

(3-5 soru — kolay, orta, zor karışık)

---
Türkçe yaz. Öğrencinin anlayacağı sadelikte ama akademik doğrulukta ol.`;

  const prompt =
    `${files.length} kaynaktan ders notu hazırla. ` +
    `Görsellerdeki TÜM yazıları, formülleri ve şemaları oku ve not haline getir. ` +
    `Konuyu anlamayı kolaylaştıracak şekilde yapılandır.`;

  return processFilesMultimodal(files, prompt, systemPrompt, onChunk);
}
