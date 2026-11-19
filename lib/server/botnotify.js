// Tells the Telegram bot service to message a Telegram account (POST BOT_URL/notify). Only a few events; tg:<id> accounts and email accounts linked to Telegram.
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
  friend: ['friendJoined', []], // an invited friend signed up (no ticket)
  invTicket: ['friendJoined', []], // an invited friend signed up (the inviter also got a free ticket)
  giftTicket: ['gift', []], // the friend's welcome ticket: a gift is waiting
  giftTickets: ['giftTickets', ['n']], // support gave free boost tickets (admin.js giftTo; sent with botSend(), the in-app note has no code)
  giftMiner: ['giftMiner', ['th', 'days']], // support gave a free miner (same)
  wdCode: ['wdCode', ['code', 'ref']], // a withdrawal code: sent with botSend() (db.js), never saved as a notification. ref = the code's time (wdTg.at): the Accept and Deny buttons carry it
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

// The Telegram id a notification goes to: a tg:<id> account, or an email account linked with /link (u.botTg). Null for anything else.
export const tgIdOf = (u) => {
  const m = /^tg:(\d{1,15})$/.exec(String(u?.id || ''));
  if (m) return Number(m[1]);
  const b = u?.botTg;
  return String(u?.id || '').includes('@') && Number.isSafeInteger(b) && b > 0 ? b : null;
};

// The job for one notification, or null when it is not for the bot (no Telegram id, or not one of the events).
export function jobFor(u, n) {
  const tgId = tgIdOf(u);
  const kind = n && typeof n.code === 'string' && Object.hasOwn(KINDS, n.code) ? KINDS[n.code] : null;
  if (tgId === null || !kind || typeof n.id !== 'string') return null;
  const vars = {};
  for (const k of kind[1]) {
    const v = n.vars?.[k];
    if (typeof v === 'number' && Number.isFinite(v)) vars[k] = v;
    else if (typeof v === 'string' && v) vars[k] = v.slice(0, 200);
    else return null; // a message with a hole in it is worse than none
  }
  return { tg_id: tgId, kind: kind[0], key: n.id, vars };
}

// In-app notices the bot may never have got (made before the bot told people about them).
export const NOTICE_CODES = ['friend', 'invTicket', 'giftTicket'];

// The bot messages still owed to one account: its newest friend-joined notice, and its newest gift notice while a free ticket is unused.
// The notice id is the bot's dedupe key, so sending the same job again is harmless. Blocked and closed accounts get nothing.
export function noticeJobs(u) {
  if (!u || u.blocked || u.closedAt) return [];
  const list = Array.isArray(u.notifications) ? u.notifications : [];
  const jobs = [];
  for (const kind of ['friendJoined', 'gift']) {
    if (kind === 'gift' && !(u.freeTickets > 0)) continue;
    const n = list.find((x) => typeof x?.code === 'string' && NOTICE_CODES.includes(x.code) && KINDS[x.code][0] === kind);
    const job = n ? jobFor(u, n) : null;
    if (job) jobs.push(job);
  }
  return jobs;
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
    if (i < RETRY_MS.length) await sleep(Math.round(RETRY_MS[i] * (0.5 + Math.random()))); // 50-150% of the base, so retries do not line up
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
