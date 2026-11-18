import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { sanitizeTicker } from '@/lib/sanitize';
import { log } from '@/lib/log';
import { cacheDir } from '@/lib/cache-dir';
import { hasMinuteBudget, meteredFetch } from '@/lib/usage-meter';

export const dynamic = 'force-dynamic';

/**
 * GET /api/logo/:ticker → company icon image.
 * Chain: logoapi.sh (free, what the classic app uses) → Massive company branding (needs MASSIVE_API_KEY)
 * → Google favicon for the company homepage → 404. Rate-limit/network failures are not remembered as misses.
 * Images are cached on disk under .cache/logos (misses are remembered for a day) so each logo is fetched once.
 */
const DIR = cacheDir('logos');
const MISS_TTL = 24 * 3600_000;
type Img = { body: Buffer; type: string };
const inflight = new Map<string, Promise<{ img: Img | null; transient: boolean }>>();

async function fetchImage(url: string, headers: Record<string, string> = {}) {
  // Massive branding images count against the Massive key's quota; everything else is a public logo source
  const r = await meteredFetch(/^https:\/\/api\.(massive|polygon)\./.test(url) ? 'massive' : 'logos', url, { headers, redirect: 'follow', cache: 'no-store', signal: AbortSignal.timeout(8000) });
  const type = r.headers.get('content-type') ?? '';
  if (!r.ok || !type.startsWith('image/')) return null;
  const body = Buffer.from(await r.arrayBuffer());
  return body.length > 200 ? { body, type } : null; // tiny responses are generic placeholder icons
}

async function resolve(t: string): Promise<{ img: Img | null; transient: boolean }> {
  let transient = false;
  const fetchImageSafe = async (url: string, headers: Record<string, string> = {}) => {
    try { return await fetchImage(url, headers); } catch { transient = true; return null; }
  };
  const img = await find();
  return { img, transient };

  async function find(): Promise<Img | null> {
  const free = await fetchImageSafe(`https://logoapi.sh/ticker/${encodeURIComponent(t)}.png`);
  if (free) return free;
  const key = process.env.MASSIVE_API_KEY || process.env.POLYGON_API_KEY;
  let homepage: string | undefined;
  if (key && hasMinuteBudget('massive')) {
    try {
      const r = await meteredFetch('massive', `https://api.massive.com/v3/reference/tickers/${encodeURIComponent(t)}`, { headers: { Authorization: `Bearer ${key}` }, cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (r.status === 429 || r.status >= 500) transient = true;
      if (r.ok) {
        const j = (await r.json()) as { results?: { branding?: { icon_url?: string }; homepage_url?: string } };
        homepage = j.results?.homepage_url;
        const icon = j.results?.branding?.icon_url;
        if (icon && /^https:\/\/api\.(massive|polygon)\.(com|io)\//.test(icon)) {
          const img = await fetchImage(icon, { Authorization: `Bearer ${key}` });
          if (img) return img;
        }
      }
    } catch (e) {
      transient = true;
      log.debug('logo.massive_failed', { t, err: (e as Error).message });
    }
  } else if (key) {
    transient = true; // skipped for Massive's per-minute budget — try again later rather than caching a miss
  }
  if (homepage) {
    try {
      const host = new URL(homepage).hostname.replace(/^www\./, '');
      const img = await fetchImage(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`);
      if (img) return img;
    } catch { /* ignore */ }
  }
  return null;
  }
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg', 'image/webp': 'webp', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico', 'image/gif': 'gif' };

export async function GET(_req: Request, { params }: { params: { ticker: string } }) {
  if (!(await getSessionUser())) return NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required' } }, { status: 401 });
  const t = sanitizeTicker(decodeURIComponent(params.ticker));
  if (!t) return NextResponse.json({ error: { code: 'bad_request', message: 'Invalid ticker' } }, { status: 400 });
  const safe = t.replace(/[^A-Z0-9.-]/g, '_');
  await fs.mkdir(DIR, { recursive: true });
  const files = await fs.readdir(DIR);
  const hit = files.find((f) => f.startsWith(`${safe}.`) && !f.endsWith('.miss'));
  const headers = { 'cache-control': 'private, max-age=604800, immutable' };
  if (hit) {
    const ext = hit.split('.').pop()!;
    const type = Object.entries(EXT).find(([, e]) => e === ext)?.[0] ?? 'image/png';
    return new NextResponse(new Uint8Array(await fs.readFile(path.join(DIR, hit))), { headers: { ...headers, 'content-type': type } });
  }
  const miss = path.join(DIR, `${safe}.miss`);
  const st = await fs.stat(miss).catch(() => null);
  if (st && Date.now() - st.mtimeMs < MISS_TTL) return new NextResponse(null, { status: 404, headers: { 'cache-control': 'private, max-age=3600' } });

  let p = inflight.get(t);
  if (!p) { p = resolve(t).finally(() => inflight.delete(t)); inflight.set(t, p); }
  const { img, transient } = await p;
  if (!img) {
    if (!transient) await fs.writeFile(miss, '');
    return new NextResponse(null, { status: 404, headers: { 'cache-control': 'private, max-age=3600' } });
  }
  const type = img.type.split(';')[0];
  await fs.writeFile(path.join(DIR, `${safe}.${EXT[type] ?? 'png'}`), img.body);
  return new NextResponse(new Uint8Array(img.body), { headers: { ...headers, 'content-type': type } });
}
