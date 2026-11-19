// Admin bulk sends (lib/server/botqueue.js): which notices are owed, one job at a time, batches, pause and cancel, news for everyone, send to one.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, tx, withUser, createUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const { noticeJobs } = await import('@/lib/server/botnotify');
const bq = await import('@/lib/server/botqueue');

const CFG = { url: 'https://bot.test', secret: 'q'.repeat(32) };
let seq = 0;
const uid = () => `tg:${6000000 + ((Date.now() + seq++ * 17) % 1000000)}`;
const nid = () => `n${Date.now().toString(36)}${(seq++).toString(36)}abcd`;
const notice = (code) => ({ id: nid(), code, kind: 'info', title: 'Notice', body: 'Body', at: Date.now() });

// A fetch that records the bot posts; status can be changed per test.
const posts = [];
let status = 200;
const fetchFn = async (url, init) => {
  posts.push({ url: String(url), body: JSON.parse(init.body) });
  return { ok: status >= 200 && status < 300, status };
};
const opts = { fetchFn, sleep: async () => {} };
const keysOf = (id) => posts.filter((p) => p.body.tg_id === Number(id.slice(3))).map((p) => p.body.kind).sort();

// Saves the notices straight on the account (notify() would call the bot at once).
async function mk(id, patch = {}) {
  await tx((c) => createUser(c, id));
  await withUser(id, (u) => {
    Object.assign(u, patch);
  });
  return id;
}
const stopAny = async () => {
  await bq.control('cancel');
};
// Rounds until the job is finished (a cap keeps a bug from looping).
const drain = async (extra = {}) => {
  for (let i = 0; i < 2000; i += 1) if (!(await bq.tick({ cfg: CFG, opts, ...extra }))) return;
  assert.fail('the job never finished');
};

before(async () => {
  await migrate();
  await stopAny();
});
after(async () => {
  await stopAny();
  await pool().end();
});

test('noticeJobs: newest notice per kind, gift only while a free ticket is unused, nothing for blocked or closed', () => {
  const tg = { id: 'tg:555001', freeTickets: 1 };
  const friendNew = notice('friend');
  const friendOld = notice('invTicket');
  const gift = notice('giftTicket');
  const jobs = noticeJobs({ ...tg, notifications: [friendNew, gift, friendOld] });
  assert.deepEqual(jobs.map((j) => j.kind).sort(), ['friendJoined', 'gift']);
  assert.equal(jobs.find((j) => j.kind === 'friendJoined').key, friendNew.id, 'the newest one wins');
  assert.equal(jobs.find((j) => j.kind === 'gift').key, gift.id);
  assert.deepEqual(noticeJobs({ ...tg, freeTickets: 0, notifications: [friendNew, gift] }).map((j) => j.kind), ['friendJoined'], 'ticket already used');
  assert.deepEqual(noticeJobs({ ...tg, blocked: true, notifications: [friendNew] }), []);
  assert.deepEqual(noticeJobs({ ...tg, closedAt: Date.now(), notifications: [friendNew] }), []);
  assert.deepEqual(noticeJobs({ ...tg, notifications: [{ ...notice('depPaid'), vars: { usd: '5.00' } }] }), [], 'other codes are not owed');
  assert.deepEqual(noticeJobs({ id: 'a@b.com', notifications: [friendNew] }), [], 'email account without Telegram');
  assert.deepEqual(noticeJobs(null), []);
});

test('one job at a time; pause, resume and cancel; a new one can start after', async () => {
  await stopAny();
  await mk(uid(), { notifications: [notice('friend')] });
  assert.equal((await bq.startJob({ type: 'nope' })).status, 400);
  const a = await bq.startJob({ type: 'notices' });
  assert.ok(a.ok, JSON.stringify(a));
  assert.equal(a.job.state, 'running');
  assert.ok(a.job.total >= 1);
  assert.equal((await bq.startJob({ type: 'notices' })).status, 409, 'a second one is refused');
  assert.equal((await bq.control('resume')).status, 409, 'not paused');
  assert.equal((await bq.control('pause')).job.state, 'paused');
  assert.equal((await bq.control('pause')).status, 409, 'already paused');
  assert.equal((await bq.startJob({ type: 'notices' })).status, 409, 'paused still counts as active');
  assert.equal((await bq.control('resume')).job.state, 'running');
  assert.equal((await bq.control('nope')).status, 400);
  const c = await bq.control('cancel');
  assert.equal(c.job.state, 'cancelled');
  assert.ok(c.job.endedAt);
  assert.equal((await bq.control('cancel')).status, 409, 'nothing left to cancel');
  assert.equal((await bq.getJob()).state, 'cancelled');
  const b = await bq.startJob({ type: 'notices' });
  assert.ok(b.ok, 'a new send can start');
  assert.notEqual(b.job.id, a.job.id);
  await stopAny();
});

test('a notices job posts each owed notice once, in batches, and finishes', async () => {
  await stopAny();
  const both = await mk(uid(), { freeTickets: 1, notifications: [notice('giftTicket'), notice('invTicket')] });
  const one = await mk(uid(), { notifications: [notice('friend')] });
  const none = await mk(uid(), { notifications: [{ ...notice('depPaid'), vars: { usd: '5.00' } }] });
  posts.length = 0;
  status = 200;
  const start = await bq.startJob({ type: 'notices' });
  assert.ok(start.ok, JSON.stringify(start));

  // a batch of 1 looks at one account and leaves the job running
  assert.equal(await bq.tick({ batch: 1, cfg: CFG, opts }), true);
  const mid = await bq.getJob();
  assert.equal(mid.state, 'running');
  assert.notEqual(mid.after, '', 'the cursor moved');

  await drain({ batch: 1 });
  const job = await bq.getJob();
  assert.equal(job.state, 'done');
  assert.ok(job.endedAt);
  assert.ok(job.done >= 2, `done ${job.done}`);
  assert.ok(job.msgs >= 3, `msgs ${job.msgs}`);
  assert.deepEqual(keysOf(both), ['friendJoined', 'gift']);
  assert.deepEqual(keysOf(one), ['friendJoined']);
  assert.deepEqual(keysOf(none), []);
  assert.ok(posts.every((p) => p.url === 'https://bot.test/notify'));
});

test('a paused job sends nothing; the bot being off holds a notices job; a refusing bot is counted, not retried', async () => {
  await stopAny();
  const id = await mk(uid(), { notifications: [notice('friend')] });
  assert.ok((await bq.startJob({ type: 'notices' })).ok);

  await bq.control('pause');
  posts.length = 0;
  assert.equal(await bq.tick({ cfg: CFG, opts }), false);
  assert.equal(posts.length, 0, 'paused');
  await bq.control('resume');

  assert.equal(await bq.tick({ cfg: null, opts }), false);
  assert.equal(posts.length, 0, 'bot off');
  const held = await bq.getJob();
  assert.equal(held.state, 'running', 'nothing lost, still running');
  assert.equal(held.after, '');
  assert.equal(held.done, 0);

  status = 400; // the bot says no: one try each
  posts.length = 0;
  await drain();
  status = 200;
  const job = await bq.getJob();
  assert.equal(job.state, 'done');
  assert.ok(job.failed >= 1, `failed ${job.failed}`);
  assert.equal(posts.filter((p) => p.body.tg_id === Number(id.slice(3))).length, 1);
});

test('a cancel that comes during a round stays cancelled', async () => {
  await stopAny();
  await mk(uid(), { notifications: [notice('friend')] });
  assert.ok((await bq.startJob({ type: 'notices' })).ok);
  const slow = async (url, init) => {
    await bq.control('cancel'); // the admin cancels while the round is posting
    return fetchFn(url, init);
  };
  await bq.tick({ batch: 50, cfg: CFG, opts: { ...opts, fetchFn: slow } });
  const job = await bq.getJob();
  assert.equal(job.state, 'cancelled');
  assert.ok(job.done >= 1, 'the round still counted');
});

test('a news job puts the message in every account in batches', async () => {
  await stopAny();
  const a = await mk(uid());
  const b = await mk(`mail${Date.now()}${seq++}@x.test`);
  const title = `News ${nid()}`;
  const start = await bq.startJob({ type: 'news', title, body: 'Hello all' });
  assert.ok(start.ok, JSON.stringify(start));
  assert.ok(start.job.total >= 2);
  posts.length = 0;
  await drain({ batch: 50 });
  const job = await bq.getJob();
  assert.equal(job.state, 'done');
  assert.ok(job.done >= 2);
  for (const id of [a, b]) {
    let got;
    await withUser(id, (u) => {
      got = u.notifications.filter((n) => n.title === title).length;
    });
    assert.equal(got, 1, `${id} got it once`);
  }
  assert.equal(posts.length, 0, 'news is not a bot notice');
});

test('send to one: an account id or a Telegram number; plain errors otherwise', async () => {
  await stopAny();
  assert.equal((await bq.sendOne('tg:1', { cfg: CFG, opts })).status, 404);
  assert.equal((await bq.sendOne('', { cfg: CFG, opts })).status, 404);
  const mail = await mk(`mail${Date.now()}${seq++}@x.test`, { notifications: [notice('friend')] });
  assert.equal((await bq.sendOne(mail, { cfg: CFG, opts })).status, 422, 'not a Telegram account');

  const id = await mk(uid(), { freeTickets: 1, notifications: [notice('friend'), notice('giftTicket')] });
  posts.length = 0;
  status = 200;
  const r = await bq.sendOne(id.slice(3), { cfg: CFG, opts }); // digits only
  assert.deepEqual(r, { ok: true, sent: 2, waiting: 2 });
  assert.deepEqual(keysOf(id), ['friendJoined', 'gift']);

  assert.equal((await bq.sendOne(id, { cfg: null, opts })).status, 503, 'bot off');
  status = 400;
  assert.equal((await bq.sendOne(id, { cfg: CFG, opts })).status, 502, 'bot refused');
  status = 200;

  const empty = await mk(uid(), { notifications: [] });
  assert.deepEqual(await bq.sendOne(empty, { cfg: CFG, opts }), { ok: true, sent: 0, waiting: 0 });
});

test('countWaiting counts accounts and each kind', async () => {
  await stopAny();
  const before = await bq.countWaiting();
  await mk(uid(), { freeTickets: 1, notifications: [notice('friend'), notice('giftTicket')] });
  await mk(uid(), { notifications: [notice('invTicket')] });
  const now = await bq.countWaiting();
  assert.equal(now.users - before.users, 2);
  assert.equal(now.friend - before.friend, 2);
  assert.equal(now.gift - before.gift, 1);
});
