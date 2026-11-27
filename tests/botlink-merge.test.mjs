// Linking an email account to a Telegram id that already has its own account (tg:<id>): the two are merged, after the person confirms.
// Money, miners, friends and codes of both end up on the email account, an empty side loses to a non-empty one, and nothing is lost.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

const { pool, q, getUser, withUser, tx, createUser, usersIn, takeSerial } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const { assignCode } = await import('@/lib/server/referrals');
const { makeContract } = await import('@/lib/contracts');
const { botLinkStart, botLinkClaim, maskEmail } = await import('@/lib/server/botlink');
const { linkFor, referralsFor } = await import('@/lib/server/botapi');

const run = `bm${Date.now().toString(36)}`;
const PW = 'correct horse 1';
const account = async (name) => {
  const e = `${name}-${run}@test.dev`;
  assert.ok((await auth.signup({ email: e, password: PW })).ok);
  return e;
};
const tgId = () => 8_000_000_000 + Math.floor(Math.random() * 900_000_000);
// A Telegram account with no sign-in, as telegramLogin makes it (with its default invite code when asked).
const tgAccount = async (tg, { code = false } = {}) => {
  await tx(async (c) => {
    const u = await createUser(c, `tg:${tg}`);
    if (code) await assignCode(c, u);
  });
  return `tg:${tg}`;
};
const addMiner = (id) =>
  tx(async (c) => {
    const serial = await takeSerial(c);
    await usersIn(c, [id], (map) => {
      map.get(id).contracts.push(makeContract({ name: 'Test', th: 10, hall: 'tx-1', days: 30, daily: '$1.00', price: 10 }, serial));
    });
    return serial;
  });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);
const exists = async (id) => (await q('SELECT 1 FROM users WHERE id = $1', [id])).rowCount > 0;
const closedOf = async (email) => (await q("SELECT id, ref_by, data FROM users WHERE data->>'mergedInto' = $1", [email])).rows;

const TOKEN = 'test-bot-token';
const initData = (tg) => {
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: tg, first_name: 'Merge' }) });
  const check = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const key = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  p.set('hash', createHmac('sha256', key).update(check).digest('hex'));
  return p.toString();
};

before(async () => {
  await migrate();
});
after(async () => {
  await pool().end();
});

test('both accounts have money and miners: everything is added, the Telegram row is closed, the link is set, the code is used up', async () => {
  const email = await account('both');
  const tg = tgId();
  const tgA = await tgAccount(tg);
  await withUser(email, (u) => {
    u.withdrawn = -0.4;
    u.spent = 0.1;
    u.adjust = 0.2;
    u.freeTickets = 1;
  });
  await withUser(tgA, (u) => {
    u.withdrawn = -0.6;
    u.deposited = 0.3;
    u.freeTickets = 2;
    u.history.push({ kind: 'deposit', at: 1000, label: 'Deposit' });
  });
  const mine = await addMiner(email);
  const theirs = await addMiner(tgA);
  const { code } = await botLinkStart(email);

  const ask = await botLinkClaim(tg, code);
  assert.equal(ask.status, 428, 'without a confirmation nothing is merged');
  assert.equal(ask.confirm, true);
  assert.equal(ask.email, maskEmail(email));
  assert.equal((await getUser(email)).botTg, undefined);
  assert.ok(await exists(tgA), 'the Telegram account is untouched');

  const r = await botLinkClaim(tg, code, { confirm: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.merged, true);
  const u = await getUser(email);
  assert.equal(u.botTg, tg);
  assert.equal(u.botLink, undefined);
  near(u.withdrawn, -1.0);
  near(u.spent, 0.1);
  near(u.adjust, 0.2);
  near(u.deposited, 0.3);
  assert.equal(u.freeTickets, 3);
  assert.deepEqual(u.contracts.map((m) => m.serial).sort(), [mine, theirs].sort());
  assert.ok(u.history.some((h) => h.label === 'Deposit'), 'the history moved over');
  assert.equal(await exists(tgA), false, 'the Telegram account is gone');
  const closed = await closedOf(email);
  assert.equal(closed.length, 1);
  assert.match(closed[0].id, /^closed:/);
  assert.equal(closed[0].data.contracts, undefined, 'no copy of the money or miners stays behind');
  assert.equal((await q("SELECT 1 FROM ledger WHERE user_id = $1 AND kind = 'merge'", [email])).rowCount, 1);
  assert.equal((await botLinkClaim(tg, code, { confirm: true })).status, 404, 'the code works once');
});

test('an empty email account is overwritten by the Telegram account', async () => {
  const email = await account('empty-email');
  const tg = tgId();
  const tgA = await tgAccount(tg);
  await withUser(tgA, (u) => {
    u.withdrawn = -0.5;
  });
  const serial = await addMiner(tgA);
  const r = await botLinkClaim(tg, (await botLinkStart(email)).code, { confirm: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  const u = await getUser(email);
  near(u.withdrawn, -0.5);
  assert.deepEqual(u.contracts.map((m) => m.serial), [serial]);
  assert.equal(await exists(tgA), false);
});

test('an empty Telegram account adds nothing: the email account stays as it was', async () => {
  const email = await account('empty-tg');
  const tg = tgId();
  const tgA = await tgAccount(tg);
  await withUser(email, (u) => {
    u.withdrawn = -0.7;
  });
  const serial = await addMiner(email);
  const r = await botLinkClaim(tg, (await botLinkStart(email)).code, { confirm: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  const u = await getUser(email);
  near(u.withdrawn, -0.7);
  assert.deepEqual(u.contracts.map((m) => m.serial), [serial]);
  assert.equal(u.botTg, tg);
  assert.equal(await exists(tgA), false);
});

test('friends and invite codes of the Telegram account move to the email account', async () => {
  const email = await account('kin');
  const friend = await account('kin-friend');
  const tg = tgId();
  const tgA = await tgAccount(tg, { code: true });
  const oldCode = (await q('SELECT code FROM codes WHERE user_id = $1 AND is_default', [tgA])).rows[0].code;
  const ownCode = (await q('SELECT code FROM codes WHERE user_id = $1 AND is_default', [email])).rows[0].code;
  await withUser(friend, (u) => {
    u.refBy = tgA;
    u.refAt = Date.now();
    u.refUsed = oldCode;
  });
  assert.equal((await botLinkClaim(tg, (await botLinkStart(email)).code, { confirm: true })).ok, true);
  const f = (await q("SELECT ref_by, data->>'refBy' AS r FROM users WHERE id = $1", [friend])).rows[0];
  assert.equal(f.ref_by, email, 'the friend now belongs to the email account');
  assert.equal(f.r, email);
  const moved = (await q('SELECT user_id, is_default, name FROM codes WHERE code = $1', [oldCode])).rows[0];
  assert.equal(moved.user_id, email);
  assert.equal(moved.is_default, false, 'an account has one default code');
  assert.equal(moved.name, 'Telegram');
  assert.equal((await q('SELECT is_default FROM codes WHERE code = $1', [ownCode])).rows[0].is_default, true, 'the email account keeps its own default code');
});

test('the Telegram account inviter is taken over when the email account has none', async () => {
  const email = await account('adopt');
  const inviter = await account('adopt-inviter');
  const tg = tgId();
  const tgA = await tgAccount(tg);
  await withUser(tgA, (u) => {
    u.refBy = inviter;
    u.refAt = 12345;
    u.refUsed = 'VTX-AAAA';
  });
  assert.equal((await botLinkClaim(tg, (await botLinkStart(email)).code, { confirm: true })).ok, true);
  const u = await getUser(email);
  assert.equal(u.refBy, inviter);
  assert.equal(u.refAt, 12345);
  assert.equal((await q('SELECT ref_by FROM users WHERE id = $1', [email])).rows[0].ref_by, inviter);
  assert.equal((await closedOf(email))[0].ref_by, null, 'the closed record no longer counts as that inviter\'s friend');
});

test('both invited by different people: the email account keeps its inviter, the other inviter keeps earning from the closed record', async () => {
  const email = await account('two');
  const invA = await account('two-a');
  const invB = await account('two-b');
  const tg = tgId();
  const tgA = await tgAccount(tg);
  await withUser(email, (u) => {
    u.refBy = invA;
    u.refAt = 1;
  });
  await withUser(tgA, (u) => {
    u.refBy = invB;
    u.refAt = 2;
  });
  const serial = await addMiner(tgA);
  assert.equal((await botLinkClaim(tg, (await botLinkStart(email)).code, { confirm: true })).ok, true);
  assert.equal((await getUser(email)).refBy, invA);
  const closed = (await closedOf(email))[0];
  assert.equal(closed.ref_by, invB);
  assert.deepEqual(closed.data.contracts.map((m) => m.serial), [serial], 'a copy of the miners stays so invB\'s reward is the same as before');
});

test('an unfinished withdrawal on the Telegram account stops the merge, nothing changes; once it is done the merge goes through', async () => {
  const email = await account('open');
  const tg = tgId();
  const tgA = await tgAccount(tg);
  const wid = `wd_${run}_open`;
  await q("INSERT INTO withdrawals (id, user_id, status, at, data) VALUES ($1, $2, 'pending', $3, '{}'::jsonb)", [wid, tgA, Date.now()]);
  const { code } = await botLinkStart(email);
  const r = await botLinkClaim(tg, code, { confirm: true });
  assert.equal(r.status, 423);
  assert.ok(await exists(tgA));
  assert.equal((await getUser(email)).botTg, undefined);
  assert.ok((await getUser(email)).botLink, 'the code was not used up');
  await q("UPDATE withdrawals SET status = 'sent' WHERE id = $1", [wid]);
  assert.equal((await botLinkClaim(tg, code, { confirm: true })).ok, true);
  assert.equal((await q('SELECT user_id FROM withdrawals WHERE id = $1', [wid])).rows[0].user_id, email, 'the finished withdrawal follows the money');
  await q('DELETE FROM withdrawals WHERE id = $1', [wid]); // the files share one database: another test lists sent withdrawals and expects full rows
});

test('a blocked Telegram account is not merged', async () => {
  const email = await account('blocked');
  const tg = tgId();
  const tgA = await tgAccount(tg);
  await withUser(tgA, (u) => {
    u.blocked = Date.now();
  });
  const { code } = await botLinkStart(email);
  assert.equal((await botLinkClaim(tg, code, { confirm: true })).status, 403);
  assert.ok(await exists(tgA));
  assert.equal((await getUser(email)).botTg, undefined);
});

test('the answers waiting for a confirmation do not use up the tries', async () => {
  const email = await account('tries');
  const tg = tgId();
  await tgAccount(tg);
  const { code } = await botLinkStart(email);
  for (let i = 0; i < 7; i++) assert.equal((await botLinkClaim(tg, code)).status, 428);
  assert.equal((await botLinkClaim(tg, code, { confirm: true })).ok, true);
});

test('the bot call: 428 until confirm is sent, then merged, and the bot answers for the email account', async () => {
  const email = await account('call');
  const tg = tgId();
  await tgAccount(tg);
  const { code } = await botLinkStart(email);
  const ask = await linkFor({ tg_id: tg, code });
  assert.equal(ask.status, 428);
  assert.deepEqual(ask.json, { ok: false, error: 'This Telegram already has an account. Confirm to merge it.', confirm: true, email: maskEmail(email) });
  assert.equal((await linkFor({ tg_id: tg, code, confirm: 'yes' })).status, 428, 'only the value true counts');
  const done = await linkFor({ tg_id: tg, code, confirm: true });
  assert.equal(done.status, 200);
  assert.deepEqual(done.json, { ok: true, email: maskEmail(email), merged: true });
  assert.equal((await referralsFor({ tg_id: tg })).status, 200);
});

test('after a merge Telegram sign-in opens the email account and makes no new account', async () => {
  const was = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = TOKEN;
  try {
    const email = await account('login');
    const tg = tgId();
    const tgA = await tgAccount(tg);
    assert.equal((await botLinkClaim(tg, (await botLinkStart(email)).code, { confirm: true })).ok, true);
    const r = await auth.telegramLogin(initData(tg), '');
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.id, email);
    assert.equal(await exists(tgA), false);
  } finally {
    if (was === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = was;
  }
});
