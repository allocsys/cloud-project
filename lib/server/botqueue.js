// Admin sends that reach many accounts (lib/server/admin.js): the old friend and gift bot notices, and the in-app news for everyone.
// One job at a time, kept in meta 'botqueue' (no table). A timer takes BATCH accounts per round (by id, so a restart carries on where it
// stopped) and rests EVERY ms between rounds, so a big send never presses the servers or the bot. Only one server runs a round at a time.
// Accounts that blocked the bot are the bot's business (bot/src/queue.js marks the chat inactive); here we only pace the posts.
// The bot dedupes by the notice id, so sending the same notice again is harmless.
import { randomBytes } from 'node:crypto';
import { q, warm, hydrate, metaUpdate, userExists, getUser, withUsers, notify, exclusive } from '@/lib/server/db';
import { botConfig, noticeJobs, sendJobs, tgIdOf, NOTICE_CODES } from '@/lib/server/botnotify';

const KEY = 'botqueue';
export const BATCH = 50;
const EVERY = 5000; // rest between rounds
const FIRST = 15_000; // after boot
const state = (globalThis.__vtxBotQueue ||= { running: false });
const fail = (status, error) => ({ ok: false, status, error });
const active = (j) => !!j && (j.state === 'running' || j.state === 'paused');

// Telegram-linked accounts holding one of the old notices, in id order after `after`.
const codeParams = NOTICE_CODES.map((c) => JSON.stringify([{ code: c }]));
const CANDIDATES = `SELECT id, data FROM users WHERE id > $1 AND (id LIKE 'tg:%' OR data->>'botTg' IS NOT NULL)
  AND (${NOTICE_CODES.map((_, i) => `data->'notifications' @> $${i + 3}::jsonb`).join(' OR ')}) ORDER BY id LIMIT $2`;
const candidates = async (after, limit) => (await q(CANDIDATES, [after, limit, ...codeParams])).rows.map((r) => hydrate(r.id, r.data));

// The job now (fresh from the database, never the 3 s copy), or null.
export const getJob = async () => (await q('SELECT data FROM meta WHERE key = $1', [KEY])).rows[0]?.data || null;

// How many accounts still owe a bot notice: { users, friend, gift }.
export async function countWaiting() {
  await warm();
  let after = '';
  const out = { users: 0, friend: 0, gift: 0 };
  for (;;) {
    const list = await candidates(after, 200);
    for (const u of list) {
      const jobs = noticeJobs(u);
      if (jobs.length) out.users += 1;
      for (const j of jobs) out[j.kind === 'friendJoined' ? 'friend' : 'gift'] += 1;
    }
    if (list.length < 200) return out;
    after = list[list.length - 1].id;
  }
}

// The waiting notices of one account, right now. A number is a Telegram id (tg:<id>); anything else is the account id.
export async function sendOne(raw, { cfg = botConfig(), opts } = {}) {
  const text = String(raw ?? '').trim();
  const id = /^\d{1,15}$/.test(text) ? `tg:${text}` : text;
  if (!id || !(await userExists(id))) return fail(404, 'User not found.');
  const u = await getUser(id);
  if (tgIdOf(u) === null) return fail(422, 'Not a Telegram account.');
  const jobs = noticeJobs(u);
  if (!jobs.length) return { ok: true, sent: 0, waiting: 0 };
  if (!cfg) return fail(503, 'Telegram bot is off.');
  const res = await sendJobs(jobs, cfg, opts);
  const sent = res.filter(Boolean).length;
  if (!sent) return fail(502, 'The bot did not take it.');
  return { ok: true, sent, waiting: jobs.length };
}

// Starts a job: { type: 'notices' } or { type: 'news', title, body }. 409 while another one is running or paused.
export async function startJob(spec) {
  const type = spec?.type;
  let total = 0;
  if (type === 'notices') total = (await countWaiting()).users;
  else if (type === 'news') total = Number((await q('SELECT count(*) AS n FROM users')).rows[0].n) || 0;
  else return fail(400, 'Unknown send.');
  if (!total) return fail(422, 'Nothing waiting.');
  const job = {
    id: `j${Date.now().toString(36)}${randomBytes(3).toString('hex')}`,
    type,
    state: 'running',
    after: '',
    done: 0,
    total,
    msgs: 0,
    failed: 0,
    title: type === 'news' ? String(spec.title ?? '') : '',
    body: type === 'news' ? String(spec.body ?? '') : '',
    startedAt: Date.now(),
    endedAt: null,
  };
  return metaUpdate(KEY, (cur) => (active(cur) ? { result: fail(409, 'Another send is running. Pause or cancel it first.') } : { value: job, result: { ok: true, job } }));
}

// op: 'pause' | 'resume' | 'cancel'.
export async function control(op) {
  return metaUpdate(KEY, (cur) => {
    if (!active(cur)) return { result: fail(409, 'No send in progress.') };
    let next;
    if (op === 'pause') {
      if (cur.state !== 'running') return { result: fail(409, 'Already paused.') };
      next = { ...cur, state: 'paused' };
    } else if (op === 'resume') {
      if (cur.state !== 'paused') return { result: fail(409, 'Not paused.') };
      next = { ...cur, state: 'running' };
    } else if (op === 'cancel') next = { ...cur, state: 'cancelled', endedAt: Date.now() };
    else return { result: fail(400, 'Unknown action.') };
    return { value: next, result: { ok: true, job: next } };
  });
}

// One round: up to `batch` accounts. Returns true while more is left. The bot being off holds a notices job (nothing is lost).
export async function tick({ batch = BATCH, cfg = botConfig(), opts } = {}) {
  const job = await getJob();
  if (!job || job.state !== 'running') return false;
  if (job.type === 'notices' && !cfg) return false;
  await warm();
  let size = 0; // accounts looked at
  let n = 0; // accounts that counted
  let sent = 0;
  let failed = 0;
  let last = job.after;
  if (job.type === 'notices') {
    const list = await candidates(job.after, batch);
    const jobs = [];
    for (const u of list) {
      const j = noticeJobs(u);
      if (j.length) n += 1;
      jobs.push(...j);
    }
    const res = await sendJobs(jobs, cfg, opts);
    sent = res.filter(Boolean).length;
    failed = res.length - sent;
    size = list.length;
    last = list.length ? list[list.length - 1].id : job.after;
  } else {
    const ids = (await q('SELECT id FROM users WHERE id > $1 ORDER BY id LIMIT $2', [job.after, batch])).rows.map((r) => r.id);
    if (ids.length) {
      await withUsers(ids, (map) => {
        for (const u of map.values()) notify(u, { kind: 'news', title: job.title, body: job.body });
      });
    }
    size = ids.length;
    n = ids.length;
    last = ids.length ? ids[ids.length - 1] : job.after;
  }
  const finished = size < batch;
  // Pause or cancel that came during the round is kept; the round's own counts are still added.
  await metaUpdate(KEY, (cur) => {
    if (!cur || cur.id !== job.id) return {};
    const next = { ...cur, after: last, done: cur.done + n, msgs: cur.msgs + sent, failed: (cur.failed || 0) + failed };
    if (finished && active(cur)) Object.assign(next, { state: 'done', endedAt: Date.now() });
    return { value: next };
  });
  return !finished;
}

// Called once at boot.
export function startBotQueueTicker() {
  if (globalThis.__vtxBotQueueTimer) return;
  const run = async () => {
    if (state.running) return;
    state.running = true;
    try {
      const j = await getJob();
      if (j?.state === 'running') await exclusive('botqueue', () => tick());
    } catch (e) {
      console.error('[botqueue] round failed:', e.message);
    } finally {
      state.running = false;
    }
  };
  globalThis.__vtxBotQueueTimer = setInterval(run, EVERY);
  globalThis.__vtxBotQueueTimer.unref?.();
  setTimeout(run, FIRST).unref?.();
}
