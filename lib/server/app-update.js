import { pickTag, cleanManifest, releaseUrl, REPO } from '@/lib/app-update';
import { bucketConfig, presignGet } from '@/lib/server/bucket';

// The newest app release, read from the bucket and GitHub (the newer one wins; the bucket on a tie) and remembered for 10 minutes (one reader for all phones; an error keeps the last good answer).
const TTL = 10 * 60 * 1000;
const RETRY = 60 * 1000;
let cache = null; // { at, v }
let pending = null;

// latest.json in the bucket is the manifest of the newest uploaded release (written last, after its files).
async function fromBucket() {
  const c = bucketConfig();
  if (!c) return null;
  const r = await fetch(presignGet(c, 'latest.json', 60), { cache: 'no-store', signal: AbortSignal.timeout(6000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`bucket ${r.status}`);
  const m = await r.json();
  const v = cleanManifest(m, `app-v${m?.versionCode}`);
  return v && { ...v, bucket: true };
}

async function load() {
  const [b, g] = await Promise.allSettled([fromBucket(), fromGitHub()]);
  const bv = b.status === 'fulfilled' ? b.value : null;
  const gv = g.status === 'fulfilled' ? g.value : null;
  if (bv && (!gv || bv.code >= gv.code)) return bv;
  if (gv) return gv;
  if (b.status === 'rejected') throw b.reason;
  if (g.status === 'rejected') throw g.reason;
  return null;
}

async function fromGitHub() {
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=10`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'vertexhash' },
    signal: AbortSignal.timeout(6000),
  });
  if (!r.ok) throw new Error(`releases ${r.status}`);
  const tag = pickTag(await r.json());
  if (!tag) return null;
  const m = await fetch(releaseUrl(tag, 'manifest.json'), { signal: AbortSignal.timeout(6000) });
  if (!m.ok) throw new Error(`manifest ${m.status}`);
  return cleanManifest(await m.json(), tag);
}

export async function latestApp() {
  if (cache && Date.now() - cache.at < TTL) return cache.v;
  if (!pending) {
    pending = load()
      .then((v) => {
        cache = { at: Date.now(), v };
        return v;
      })
      .catch(() => {
        cache = { at: Date.now() - TTL + RETRY, v: cache ? cache.v : null };
        return cache.v;
      })
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}
