// Calm retries for background checks. After a failed answer (error, timeout, 429, 503) a key waits before the next quiet check:
// 15 s, then 30, 60, 120, up to 5 minutes, plus a little random spread so many phones do not return together.
// A Retry-After from the server (seconds) is honoured when it is longer. The first good answer clears it.
// Only background checks (polls, tab focus) wait. A tap by the person, or a screen opening, still asks at once.
const MAX = 300000;
const st = new Map(); // key -> { fails, until }

export const waiting = (key, now = Date.now()) => now < (st.get(key)?.until || 0);

export function good(key) {
  st.delete(key);
}

export function bad(key, retryAfter = 0, now = Date.now(), rnd = Math.random()) {
  const fails = (st.get(key)?.fails || 0) + 1;
  const base = Math.min(MAX, 15000 * 2 ** (fails - 1));
  const ms = Math.min(MAX, Math.max(Number(retryAfter) > 0 ? Number(retryAfter) * 1000 : 0, base) * (1 + rnd * 0.25));
  st.set(key, { fails, until: now + ms });
}

export function failures(key) {
  return st.get(key)?.fails || 0;
}
