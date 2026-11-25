import { pickTag, cleanManifest, releaseUrl, REPO } from '@/lib/app-update';

// The newest app release, read from GitHub and remembered for 10 minutes (one reader for all phones; an error keeps the last good answer).
const TTL = 10 * 60 * 1000;
const RETRY = 60 * 1000;
let cache = null; // { at, v }
let pending = null;

async function load() {
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
