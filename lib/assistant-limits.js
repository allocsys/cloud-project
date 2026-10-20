// Ask Miner Opus: daily limits for the paid part (the LLM). FAQ answers cost nothing and are never counted.
// Counters live in memory of this server and reset at 00:00 UTC and on every deploy. That is enough to stop abuse and
// runaway spend for v1; with several servers each one keeps its own count (the global cap is then per server).
// Pure functions with an injectable clock and store, so they run in node tests.

export const USER_DAILY = 20;
export const GLOBAL_DAILY = 500;

const dayOf = (now) => new Date(now).toISOString().slice(0, 10);

const shared = (globalThis.__opusAsk ||= { day: '', users: new Map(), total: 0 });

const intEnv = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
};

export const limitsFromEnv = () => ({ user: intEnv('ASSISTANT_USER_DAILY', USER_DAILY), global: intEnv('ASSISTANT_GLOBAL_DAILY', GLOBAL_DAILY) });

function roll(store, now) {
  const d = dayOf(now);
  if (store.day !== d) {
    store.day = d;
    store.users.clear();
    store.total = 0;
  }
}

// Reserves one LLM answer for this user. Returns { ok, left } where left is what the user has after this one.
// ok=false means a limit was reached and nothing was reserved.
export function takeAnswer(userId, { now = Date.now(), store = shared, limits = limitsFromEnv() } = {}) {
  roll(store, now);
  const used = store.users.get(userId) || 0;
  if (used >= limits.user || store.total >= limits.global) return { ok: false, left: Math.max(0, limits.user - used) };
  store.users.set(userId, used + 1);
  store.total += 1;
  return { ok: true, left: limits.user - used - 1 };
}

// Gives a reservation back (the LLM call failed, so the user should not lose an answer).
export function giveBack(userId, { now = Date.now(), store = shared } = {}) {
  roll(store, now);
  const used = store.users.get(userId) || 0;
  if (used > 0) store.users.set(userId, used - 1);
  if (store.total > 0) store.total -= 1;
}

// How many LLM answers the user still has today.
export function answersLeft(userId, { now = Date.now(), store = shared, limits = limitsFromEnv() } = {}) {
  roll(store, now);
  return Math.max(0, limits.user - (store.users.get(userId) || 0));
}
