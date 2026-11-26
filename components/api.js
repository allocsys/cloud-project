'use client';
// Tiny stale-while-revalidate client cache, so screens render instantly and refresh quietly.
//   useApi(url): returns the cached copy at once (memory, then localStorage), refetches when older than
//   `ttl`, on tab focus, and every `poll` ms. Every screen using the same url updates together.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { translateError } from '@/lib/i18n/errors';
import { waiting, good, bad } from '@/lib/backoff';

const PREFIX = 'vtx-cache:';
// Runs before the browser paints (on the server it is a plain effect, which never runs there).
const useBeforePaint = typeof window === 'undefined' ? useEffect : useLayoutEffect;
const mem = new Map();
const inflight = new Map(); // key -> the request running now
const queued = new Map(); // key -> the one follow-up request waiting for the running one to end
let epoch = 0; // bumped on sign out: an answer that was in flight then must not be stored for the next person
const subs = new Map();

// True while the Worker answers maintenance (503 {error:maintenance}). The next good answer, or the strip's own health check, clears it.
let down = false;
let cool = 0; // while the Worker says maintenance, no new requests leave before this time (30-45 s), so a busy app is not hammered
const coolOff = () => Date.now() < cool;
const downSubs = new Set();
function setDown(v) {
  cool = v ? Date.now() + 30000 + Math.random() * 15000 : 0;
  if (v === down) return;
  down = v;
  downSubs.forEach((fn) => fn(v));
}
export const markUp = () => setDown(false);
export function useMaintenance() {
  const [v, setV] = useState(false);
  useEffect(() => {
    setV(down);
    downSubs.add(setV);
    return () => downSubs.delete(setV);
  }, []);
  return v;
}

// True while the last request failed at the network (no answer, timeout) or with a server error, until one succeeds. Maintenance has its own
// state above. The strip in the app layout shows it, so a screen waiting for its first answer says so instead of showing sample data.
let lost = false;
const lostSubs = new Set();
function setLost(v) {
  if (v === lost) return;
  lost = v;
  lostSubs.forEach((fn) => fn(v));
}
export function useLost() {
  const [v, setV] = useState(false);
  useEffect(() => {
    setV(lost);
    lostSubs.add(setV);
    return () => lostSubs.delete(setV);
  }, []);
  return v;
}
// Tap to retry: fetches again every address a screen is showing now.
export function retryNow() {
  for (const [k, set] of subs) if (set.size) revalidate(k, { shared: true }).catch(() => {});
}

// The API answered 401 "Sign in required.": the session is gone (expired, bad cookie, password changed, blocked). The old cookie is cleared
// (without the vtx-out note, so the Telegram automatic sign-in still works) and the person lands on the sign-in sheet. Not on the home page itself.
let leaving = false;
function toSignIn() {
  if (leaving || typeof window === 'undefined' || /^\/(fa|ar|fi|sv|ru)?\/?$/.test(window.location.pathname)) return;
  leaving = true;
  clearApiCache();
  const go = () => window.location.replace('/?auth=1');
  fetch('/api/auth/logout', { method: 'POST', keepalive: true }).then(go, go);
}

function load(key) {
  if (mem.has(key)) return mem.get(key);
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw) {
      const e = JSON.parse(raw);
      mem.set(key, e);
      return e;
    }
  } catch {}
  return null;
}

function store(key, data) {
  const e = { data, at: Date.now() };
  mem.set(key, e);
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(e));
  } catch {}
  const set = subs.get(key);
  if (set) set.forEach((fn) => fn(e));
  return e;
}

function start(key) {
  if (coolOff()) return Promise.reject(new Error('HTTP 503'));
  const ep = epoch;
  // A hung request used to wait forever (no timeout) while the screen showed stale data
  // and the next poll queued behind it. 15s is generous — even a cold server answers in
  // seconds now that the feeds are warmed at boot — and a timeout just leaves the cache
  // as it was; the next poll or tab focus retries.
  const p = fetch(key, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) })
    .then(async (r) => {
      if (!r.ok) {
        if (r.status === 503) {
          const j = await r.json().catch(() => null);
          if (j?.error === 'maintenance') setDown(true);
        }
        if (r.status === 401) {
          const j = await r.json().catch(() => null);
          if (j?.error === 'Sign in required.') toSignIn();
        }
        const e = new Error(`HTTP ${r.status}`);
        e.retryAfter = Number(r.headers.get('retry-after')) || 0;
        throw e;
      }
      setDown(false);
      setLost(false);
      return r.json();
    })
    .then((data) => (ep === epoch ? store(key, data) : { data, at: Date.now() }))
    .then(
      (e) => {
        good(key);
        return e;
      },
      (e) => {
        bad(key, e && e.retryAfter);
        const m = /^HTTP (\d+)$/.exec((e && e.message) || '');
        const failed = m ? Number(m[1]) >= 500 : !!e && (e.name === 'TypeError' || e.name === 'TimeoutError' || e.name === 'AbortError');
        if (failed && !down) setLost(true);
        throw e;
      }
    )
    .finally(() => {
      if (inflight.get(key) === p) inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}

// Refetches `key`. Called by name (after a buy, a withdrawal...) it means "fetch what the server has NOW": a request already in
// flight may have left before the change, so it is not reused. This one waits for it to end and then fetches once more, and
// callers arriving meanwhile share that one follow-up. { shared: true } (screens loading, tab focus) just joins what is running.
function revalidateOne(key, { shared = false } = {}) {
  const run = inflight.get(key);
  if (!run) return start(key);
  if (shared) return run;
  let next = queued.get(key);
  if (!next) {
    next = run
      .catch(() => {})
      .then(() => {
        queued.delete(key);
        return inflight.get(key) || start(key);
      });
    queued.set(key, next);
  }
  return next;
}

// The same screen data can sit under several keys that differ only in their query (/api/wallet and /api/wallet?limit=20&kind=all):
// "fetch what the server has NOW" has to reach all of them, or a screen showing another variant keeps the old numbers.
// Variants on screen are fetched again; the others are marked old, so their next use fetches.
export function revalidate(key, opts = {}) {
  const out = revalidateOne(key, opts);
  if (opts.shared) return out;
  const path = key.split('?')[0];
  for (const [k, e] of mem) {
    if (k === key || k.split('?')[0] !== path) continue;
    if (subs.get(k)?.size) revalidateOne(k).catch(() => {});
    else mem.set(k, { ...e, at: 0 });
  }
  return out;
}

// Call on sign out so the next person does not see this one's cached data.
export function clearApiCache() {
  epoch += 1;
  inflight.clear();
  queued.clear();
  mem.clear();
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX))
      .forEach((k) => localStorage.removeItem(k));
  } catch {}
}

// Ends the session (clears the cookie) and forgets the cached data. Always resolves.
// It also leaves a note (vtx-out) so the home screen's automatic Telegram sign-in stays off until the person signs in on purpose.
export function signOut() {
  clearApiCache();
  try {
    localStorage.setItem('vtx-out', '1');
  } catch {}
  return fetch('/api/auth/logout', { method: 'POST', keepalive: true }).catch(() => {});
}

// Call when someone signs in on purpose: the automatic sign-in may work again.
export function clearOut() {
  try {
    localStorage.removeItem('vtx-out');
  } catch {}
}

// POST JSON, or multipart when `body` is FormData. Errors carry the server's message, plus `field` and `status` when it sent them.
// A hung POST used to spin forever; 30s is generous for a gateway call, and a timeout surfaces as "no connection"
// (callers show that when there is no status). Money actions pass an idempotency key, so retrying after one is safe.
export async function post(url, body, idempotencyKey) {
  if (coolOff()) {
    const err = new Error(translateError(typeof document !== 'undefined' ? document.documentElement.lang : 'en', 'Back soon. Try again in a minute.'));
    err.status = 503;
    throw err;
  }
  const form = typeof FormData !== 'undefined' && body instanceof FormData;
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...(form ? {} : { 'content-type': 'application/json' }), ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}) },
    body: form ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  if (res.ok) setDown(false);
  else {
    if (res.status === 503 && json?.error === 'maintenance') setDown(true);
    if (res.status === 401 && json?.error === 'Sign in required.' && !String(url).startsWith('/api/auth/')) toSignIn();
    const lang = typeof document !== 'undefined' ? document.documentElement.lang : 'en';
    // The Cloudflare Worker answers { error: 'maintenance' } with 503 while the app is down or switched off.
    const text = res.status === 503 && json?.error === 'maintenance' ? 'Back soon. Try again in a minute.' : json?.error;
    const err = new Error(translateError(lang, text));
    err.field = json?.field;
    err.via = json?.via;
    err.status = res.status;
    throw err;
  }
  return json;
}

// `url` in the answer is the address the data belongs to. When the address changes (another filter, another miner) the old data is not
// shown for the new one: the fallback shows until the new answer (or its cached copy) is there. { keepStale: true } is for a screen that
// only grows the same list (a "show more" page size) and would rather keep what it has; it checks `dataUrl` itself for anything else.
// Writes an answer into the cache under `key`, as if that address had been fetched now (a bundle answer filling the single ones).
export const seedApi = (key, data) => store(key, data);

// One call for a page's data. `seeds(answer)` lists [address, data] pairs that fill the single addresses the page reads with useApi;
// those start with { enabled: go } and only ask for themselves if this call fails. Saved copies show meanwhile.
// `keys` are those addresses: while the call runs, nothing asks for them on its own (children of the page included), and if it fails
// they are fetched one by one, as before. They are held during the first render, before any child effect runs.
// key -> how many bundles hold it. A count, not a plain set: moving between bundled pages, the old page releases while the new one
// already holds, and the key must stay held until the last one lets go.
const held = new Map();
const hold = (k) => held.set(k, (held.get(k) || 0) + 1);
const unhold = (k) => {
  const n = (held.get(k) || 0) - 1;
  if (n > 0) held.set(k, n);
  else held.delete(k);
};
export function useBundle(url, keys, seeds) {
  const [go, setGo] = useState(false);
  const mine = useRef(null); // the keys this screen holds now, each counted once
  if (!mine.current) mine.current = new Set();
  const take = () =>
    keys.forEach((k) => {
      if (!mine.current.has(k)) {
        mine.current.add(k);
        hold(k);
      }
    });
  const drop = () => {
    mine.current.forEach(unhold);
    mine.current.clear();
  };
  if (!go) take();
  useEffect(() => {
    let live = true;
    take();
    const release = drop;
    // A screen that opens right after its own loading look (which already asked and was answered): no second call.
    // That answer filled the single addresses already; only the hold is let go.
    const c = load(url);
    if (c && Date.now() - c.at < 2000 && !inflight.has(url)) {
      release();
      setGo(true);
      return () => {
        live = false;
        release();
      };
    }
    // A single address updated after this call left (an instant update, a fresh fetch) is newer than the answer: it is kept.
    const t0 = Date.now();
    revalidate(url, { shared: true }).then(
      (e) => {
        release();
        if (!live) return;
        if (e.data) {
          for (const [k, v] of seeds(e.data)) {
            const cur = load(k);
            if (v != null && !(cur && cur.at > t0)) seedApi(k, v);
          }
        }
        setGo(true);
      },
      () => {
        release();
        if (!live) return;
        keys.forEach((k) => revalidate(k, { shared: true }).catch(() => {}));
        setGo(true);
      }
    );
    return () => {
      live = false;
      release();
    };
  }, [url]);
  return go;
}

// { enabled: false } only reads what is already saved: no request, no polling (a screen waiting for its bundle answer).
export function useApi(url, { ttl = 30000, poll = 0, fallback = null, keepStale = false, enabled = true } = {}) {
  // The first render takes only the in-memory copy (set by an earlier screen), so a screen opened by navigation starts filled.
  // The saved copy on the phone is read before the first paint (below): reading it here would not match the server's HTML.
  const [state, setState] = useState(() => {
    const m = mem.get(url);
    return { url, data: m ? m.data : fallback };
  });

  useBeforePaint(() => {
    const cached = load(url);
    if (cached) setState({ url, data: cached.data });
    else if (!keepStale) setState({ url, data: fallback });
  }, [url]);

  useEffect(() => {
    let live = true;
    const apply = (e) => live && setState({ url, data: e.data });
    const cached = load(url);
    if (cached) apply(cached);

    let set = subs.get(url);
    if (!set) subs.set(url, (set = new Set()));
    set.add(apply);

    const fresh = () => {
      const e = load(url);
      return !!e && Date.now() - e.at < ttl;
    };
    const run = () => (held.has(url) ? Promise.resolve() : revalidate(url, { shared: true }).catch(() => {}));
    // Background checks (focus, poll) wait while this url is backing off after failures; opening the screen does not.
    const quiet = () => {
      if (!waiting(url)) run();
    };
    if (enabled && !fresh()) run();
    const onVisible = () => {
      if (enabled && document.visibilityState === 'visible' && !fresh()) quiet();
    };
    document.addEventListener('visibilitychange', onVisible);
    const timer = poll && enabled
      ? setInterval(() => {
          if (!document.hidden) quiet();
        }, poll)
      : null;

    return () => {
      live = false;
      set.delete(apply);
      document.removeEventListener('visibilitychange', onVisible);
      if (timer) clearInterval(timer);
    };
  }, [url, ttl, poll, enabled]);

  // mutate: write straight into the cache (optimistic updates). refresh: refetch now.
  const mutate = useCallback((data) => store(url, data), [url]);
  const refresh = useCallback(() => revalidate(url), [url]);
  // For background timers (an order check every few seconds): joins a running request, and does nothing while this url backs off.
  const quiet = useCallback(() => (waiting(url) || held.has(url) ? Promise.resolve() : revalidate(url, { shared: true })), [url]);
  const mine = state.url === url;
  return { data: mine || keepStale ? state.data : fallback, dataUrl: state.url, mutate, refresh, quiet };
}
