'use client';
// Tiny stale-while-revalidate client cache, so screens render instantly and refresh quietly.
//   useApi(url): returns the cached copy at once (memory, then localStorage), refetches when older than
//   `ttl`, on tab focus, and every `poll` ms. Every screen using the same url updates together.
import { useCallback, useEffect, useState } from 'react';

const PREFIX = 'opus-cache:';
const mem = new Map();
const inflight = new Map();
const subs = new Map();

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

export function revalidate(key) {
  if (inflight.has(key)) return inflight.get(key);
  const p = fetch(key, { headers: { accept: 'application/json' } })
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then((data) => store(key, data))
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// Call on sign out so the next person does not see this one's cached data.
export function clearApiCache() {
  mem.clear();
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX))
      .forEach((k) => localStorage.removeItem(k));
  } catch {}
}

// POST JSON, or multipart when `body` is FormData. Errors carry the server's message, plus `field` and `status` when it sent them.
export async function post(url, body, idempotencyKey) {
  const form = typeof FormData !== 'undefined' && body instanceof FormData;
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...(form ? {} : { 'content-type': 'application/json' }), ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}) },
    body: form ? body : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  if (!res.ok) {
    const err = new Error(json?.error || 'Something went wrong.');
    err.field = json?.field;
    err.status = res.status;
    throw err;
  }
  return json;
}

export function useApi(url, { ttl = 30000, poll = 0, fallback = null } = {}) {
  const [state, setState] = useState({ data: fallback });

  useEffect(() => {
    let live = true;
    const apply = (e) => live && setState({ data: e.data });
    const cached = load(url);
    if (cached) apply(cached);

    let set = subs.get(url);
    if (!set) subs.set(url, (set = new Set()));
    set.add(apply);

    const fresh = () => {
      const e = load(url);
      return !!e && Date.now() - e.at < ttl;
    };
    const run = () => revalidate(url).catch(() => {});
    if (!fresh()) run();
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !fresh()) run();
    };
    document.addEventListener('visibilitychange', onVisible);
    const timer = poll ? setInterval(run, poll) : null;

    return () => {
      live = false;
      set.delete(apply);
      document.removeEventListener('visibilitychange', onVisible);
      if (timer) clearInterval(timer);
    };
  }, [url, ttl, poll]);

  // mutate: write straight into the cache (optimistic updates). refresh: refetch now.
  const mutate = useCallback((data) => store(url, data), [url]);
  const refresh = useCallback(() => revalidate(url), [url]);
  return { data: state.data, mutate, refresh };
}
