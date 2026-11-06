// Tells the Telegram bot service to message a Telegram account (POST BOT_URL/notify). Only a few events, only tg:<id> accounts.
// Signed like the gateway callbacks: hex HMAC-SHA512 of the JSON body with keys sorted recursively, header x-app-sig, secret APP_BOT_SECRET.
// sent_at is inside the signed body so an old copy cannot be replayed. Same signBody as bot/src/notify.js (a test checks they agree).
// BOT_URL or APP_BOT_SECRET empty = switched off. Nothing here may throw into a request or wait inside a transaction:
// db.js collects the jobs while the transaction runs and sends them after COMMIT, without waiting for the answer.
import { createHmac } from 'node:crypto';

// notification code -> bot kind and the vars the bot text needs
const KINDS = {
  depPaid: ['depPaid', ['usd']],
  wdSent: ['wdSent', ['amt']],
  vipDrop: ['vipDrop', ['n', 'date']],
};

const sortDeep = (v) =>
  Array.isArray(v)
    ? v.map(sortDeep)
    : v && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])]))
      : v;

export const signBody = (payload, secret) => createHmac('sha512', secret).update(JSON.stringify(sortDeep(payload))).digest('hex');

// { url, secret } when switched on, else null.
export function botConfig(env = process.env) {
  const url = String(env.BOT_URL || '').trim().replace(/\/+$/, '');
  const secret = String(env.APP_BOT_SECRET || '');
  return /^https?:\/\/[^\s/]+/.test(url) && secret.length >= 16 ? { url, secret } : null;
}

// The job for one notification, or null when it is not for the bot (not a Telegram account, or not one of the events).
export function jobFor(u, n) {
  const m = /^tg:(\d{1,15})$/.exec(String(u?.id || ''));
  const kind = n && typeof n.code === 'string' && Object.hasOwn(KINDS, n.code) ? KINDS[n.code] : null;
  if (!m || !kind || typeof n.id !== 'string') return null;
  const vars = {};
  for (const k of kind[1]) {
    const v = n.vars?.[k];
    if (typeof v === 'number' && Number.isFinite(v)) vars[k] = v;
    else if (typeof v === 'string' && v) vars[k] = v.slice(0, 200);
    else return null; // a message with a hole in it is worse than none
  }
  return { tg_id: Number(m[1]), kind: kind[0], key: n.id, vars };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const RETRY_MS = [500, 2500];

// One job, up to 3 tries on a network error or a 5xx (the key makes a repeat harmless). Never throws. Returns true when the bot took it.
export async function post(job, cfg, { fetchFn = globalThis.fetch, now = Date.now, sleep = wait } = {}) {
  for (let i = 0; i <= RETRY_MS.length; i += 1) {
    let status = 0;
    try {
      const body = { ...job, sent_at: new Date(now()).toISOString() };
      const r = await fetchFn(`${cfg.url}/notify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-app-sig': signBody(body, cfg.secret) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
      status = r.status;
      if (r.ok) return true;
    } catch {
      status = 0;
    }
    if (status >= 400 && status < 500) {
      console.error(JSON.stringify({ level: 'error', msg: 'botnotify.refused', kind: job.kind, status }));
      return false; // the bot said no: asking again will not change it
    }
    if (i < RETRY_MS.length) await sleep(RETRY_MS[i]);
  }
  console.error(JSON.stringify({ level: 'error', msg: 'botnotify.gave_up', kind: job.kind }));
  return false;
}

// Sends the jobs; the caller does not wait. The returned promise never rejects (tests wait on it).
export function sendJobs(jobs, cfg = botConfig(), opts) {
  if (!cfg || !jobs?.length) return Promise.resolve([]);
  return Promise.all(jobs.map((j) => post(j, cfg, opts).catch(() => false)));
}

// One news message (POST BOT_URL/broadcast): to every chat with news on, or with test_tg_id to that chat only. One try, never throws.
// The id makes a repeat harmless. Returns { ok, status, json }; status 0 = no answer, null cfg = the bot is off.
export async function broadcast({ id, en, fa, test_tg_id }, cfg = botConfig(), { fetchFn = globalThis.fetch, now = Date.now } = {}) {
  if (!cfg) return { ok: false, status: 0, json: null, off: true };
  const payload = { id, en, sent_at: new Date(now()).toISOString() };
  if (fa) payload.fa = fa;
  if (test_tg_id) payload.test_tg_id = test_tg_id;
  try {
    const r = await fetchFn(`${cfg.url}/broadcast`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-app-sig': signBody(payload, cfg.secret) },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    let json = null;
    try {
      json = await r.json();
    } catch {
      json = null;
    }
    return { ok: r.ok, status: r.status, json };
  } catch {
    return { ok: false, status: 0, json: null };
  }
}
