/**
 * TransWordly — SPA prerender (post-build SEO snapshot)
 *
 * Neden ayrı bir post-build script?
 *   Stack Vite 8 + Rolldown + React 19. react-snap / vite-plugin-prerender gibi
 *   eklentiler bu stack ile uyumsuz. Bu yüzden vite.config.ts'e DOKUNMAYAN,
 *   yalnızca `dist/` üzerinde çalışan bağımsız bir adım tercih edildi.
 *
 * Ne yapar?
 *   1. `dist/sitemap.xml` içindeki public route'ları okur (tek doğruluk kaynağı).
 *   2. `vite preview` ile build çıktısını lokalde servis eder.
 *   3. Puppeteer (headless Chromium) ile her route'a gidip React'in render etmesini
 *      bekler, tam DOM'u (`document.documentElement.outerHTML`) yakalar.
 *   4. Çıktıyı `dist/<route>/index.html` olarak yazar (anasayfa → `dist/index.html`).
 *
 * main.tsx createRoot KORUNUR → client'ta JS yüklenince React DOM'u tazeler
 *   (hydrate etmez, yeniden render eder) → uyuşmazlık yok, etkileşim sürer.
 *   Per-route <title>/canonical, src/components/Seo.tsx içinde useEffect ile
 *   set edilir; snapshot bunları doğru yakalar.
 *
 * SİTEYİ BOZMAMA GARANTİSİ (önemli):
 *   - Yalnızca dist/ yazılır; src / config asla değişmez.
 *   - Bir route BOŞ render olursa (root içeriği < MIN_ROOT_HTML) veya EnvErrorPage
 *     görünürse (env eksik) → o dosya YAZILMAZ, mevcut dosya korunur ve uyarı basılır.
 *     Böylece dolu/çalışan bir sayfa asla boş/hatalı bir sayfayla değiştirilmez.
 *
 * Gotcha: .env.local (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY) yoksa uygulama
 *   EnvErrorPage render eder; bu script bunu tespit edip hiçbir şey yazmaz ve sesli
 *   uyarır. Build'i mutlaka env'in bulunduğu ortamda alın.
 *   Linux VPS'te Chromium için sistem kütüphaneleri (libnss3 vb.) gerekir;
 *   tarayıcı yoksa: `npx puppeteer browsers install chrome`.
 */
import { preview } from 'vite';
import puppeteer from 'puppeteer';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = join(ROOT, 'dist');

/** Render edilmiş #root innerHTML'i bu eşikten kısaysa "boş" sayılır → yazılmaz. */
const MIN_ROOT_HTML = 150;
/** EnvErrorPage işareti (env eksikse görünür) — görülürse o sayfa yazılmaz. */
const ENV_ERROR_MARKER = 'Yapılandırma Hatası';
/** Tek route için maksimum bekleme. */
const NAV_TIMEOUT = 30_000;
const RENDER_TIMEOUT = 20_000;
const PORT = 4317;

/** dist/sitemap.xml içindeki <loc>'lardan path listesi çıkar. */
function routesFromSitemap() {
  const xml = readFileSync(join(DIST, 'sitemap.xml'), 'utf8');
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  if (locs.length === 0) throw new Error('sitemap.xml içinde <loc> bulunamadı');
  return [...new Set(locs.map((u) => new URL(u).pathname || '/'))];
}

/** route ("/legal/x") → dist içindeki çıktı dosyası ("legal/x/index.html"). */
function outFileFor(route) {
  const clean = route.replace(/^\/+|\/+$/g, '');
  return clean === '' ? join(DIST, 'index.html') : join(DIST, clean, 'index.html');
}

async function main() {
  const routes = routesFromSitemap();
  console.log(`[prerender] ${routes.length} route prerender edilecek:\n  ${routes.join('\n  ')}`);

  // 1. Build çıktısını lokalde servis et (config'i sadece OKUR, değiştirmez).
  const server = await preview({
    root: ROOT,
    preview: { port: PORT, strictPort: false },
    logLevel: 'warn',
  });
  const base = (server.resolvedUrls?.local?.[0] ?? `http://localhost:${PORT}/`).replace(/\/+$/, '');
  console.log(`[prerender] preview: ${base}`);

  // 2. Headless Chromium. VPS/root için sandbox kapalı.
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  let written = 0;
  let skipped = 0;
  let envErrorSeen = false;

  try {
    for (const route of routes) {
      const url = `${base}${route}`;
      const page = await browser.newPage();
      page.setDefaultNavigationTimeout(NAV_TIMEOUT);
      try {
        await page.goto(url, { waitUntil: 'networkidle2' });

        // React'in #root'a içerik basmasını bekle (boş kabuk değil).
        await page
          .waitForFunction(
            (min) => {
              const r = document.getElementById('root');
              return !!r && r.innerHTML.length > min;
            },
            { timeout: RENDER_TIMEOUT },
            MIN_ROOT_HTML,
          )
          .catch(() => {}); // zaman aşımı olsa da aşağıdaki guard yakalar

        // Seo useEffect'inin <title>/canonical'ı set etmesi için kısa bir oturma payı.
        await new Promise((r) => setTimeout(r, 600));

        const { rootLen, html } = await page.evaluate(() => ({
          rootLen: (document.getElementById('root')?.innerHTML.length) ?? 0,
          html: '<!doctype html>\n' + document.documentElement.outerHTML,
        }));

        // ── Guard'lar: dolu/çalışan dosyayı asla boş/hatalı ile değiştirme ──
        if (html.includes(ENV_ERROR_MARKER)) {
          envErrorSeen = true;
          skipped++;
          console.warn(`[prerender] ATLANDI (EnvErrorPage): ${route} — env eksik, dosya korundu`);
          continue;
        }
        if (rootLen < MIN_ROOT_HTML) {
          skipped++;
          console.warn(`[prerender] ATLANDI (boş render, root=${rootLen}): ${route} — dosya korundu`);
          continue;
        }

        const out = outFileFor(route);
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, html, 'utf8');
        written++;
        console.log(`[prerender] ✓ ${route}  (${rootLen} char)  → ${out.replace(DIST, 'dist')}`);
      } catch (err) {
        skipped++;
        console.warn(`[prerender] ATLANDI (hata): ${route} — ${err.message} — dosya korundu`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
    if (typeof server.close === 'function') await server.close();
    else server.httpServer?.close();
  }

  console.log(`\n[prerender] Bitti — yazıldı: ${written}, atlandı: ${skipped}`);

  if (envErrorSeen) {
    console.error(
      '\n[prerender] HATA: En az bir sayfa EnvErrorPage render etti (env eksik).\n' +
        '  .env.local (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY) bulunan ortamda build alın.\n' +
        '  Bu build SEO açısından eksik — DEPLOY ETMEYİN.',
    );
    process.exit(1);
  }
  if (written === 0) {
    console.error('[prerender] HATA: Hiçbir route yazılamadı. dist/ değişmedi.');
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('[prerender] Beklenmeyen hata:', err);
  process.exit(1);
});
