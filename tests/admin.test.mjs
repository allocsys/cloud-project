// Admin catalogue edits against a real Postgres: concurrent edits queue up, rules hold, the audit log keeps every entry.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

const { pool, q, tx, createUser, withUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const { act, overview } = await import('@/lib/server/admin');
const { getWallet, TOLERANCE } = await import('@/lib/server/wallet');
const { getPrices } = await import('@/lib/server/prices');
const auth = await import('@/lib/server/auth');

const run = `a${Date.now().toString(36)}`;
const each = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));
const many = (n, fn) => Promise.all(each(n, fn));
const catalog = async () => (await q("SELECT data FROM meta WHERE key = 'catalog'")).rows[0]?.data;
const logLen = async () => ((await q("SELECT data FROM meta WHERE key = 'adminlog'")).rows[0]?.data || []).length;
// Other test files write to the same audit log at the same time, so the balance tests count only the entries that name their own user.
const logOf = async (id) => (((await q("SELECT data FROM meta WHERE key = 'adminlog'")).rows[0]?.data) || []).filter((e) => String(e.detail).includes(id)).length;
const hall = (i) => ({ name: `T${run}${i}`, place: 'Test', power: 'Grid', efficiency: '30 J/TH', rig: 'S21', net: 0.02 });

before(async () => {
  await migrate();
  // Make sure the catalogue row exists, so the counts below start from a known place.
  assert.ok((await act({ action: 'hall-save', hall: hall('seed') })).ok);
});

after(async () => {
  await pool().end();
});

test('halls added at the same moment are all kept, and each is logged', async () => {
  const before = await catalog();
  const t0 = Date.now();
  const rs = await Promise.all(each(4, (i) => act({ action: 'hall-save', hall: hall(`c${i}`) })));
  const okCount = rs.filter((r) => r.ok).length;
  assert.equal(okCount, 4, JSON.stringify(rs.filter((r) => !r.ok)));
  const after = await catalog();
  assert.equal(Object.keys(after.halls).length, Object.keys(before.halls).length + 4);
  assert.equal(Object.hasOwn(after, 'plans'), false, 'no fixed plans in the catalogue');
  // Other test files write to the same audit log at the same time, so count only the hall saves made since this test started.
  const log = (await q("SELECT data FROM meta WHERE key = 'adminlog'")).rows[0]?.data || [];
  assert.equal(log.filter((e) => e.action === 'hall-save' && e.at >= t0).length, okCount);
});

test('a core hall cannot be removed, an unknown one is not found, and an added one can be removed', async () => {
  assert.equal((await act({ action: 'hall-delete', id: 'tx-1' })).status, 409); // core hall
  assert.equal((await act({ action: 'hall-delete', id: 'nope' })).status, 404);

  assert.ok((await act({ action: 'hall-save', hall: hall('use') })).ok);
  const halls = (await catalog()).halls;
  const id = Object.keys(halls).find((k) => halls[k].name === `T${run}use`);
  assert.ok(id);
  assert.ok((await act({ action: 'hall-delete', id })).ok);
  assert.equal(Object.hasOwn((await catalog()).halls, id), false);
});

test('actions on an unknown user are refused', async () => {
  assert.equal((await act({ action: 'miners-clear', userId: `nobody-${run}@test.dev` })).status, 404);
  assert.equal((await act({ action: 'notify', userId: `nobody-${run}@test.dev`, title: 'Hi' })).status, 404);
  assert.equal((await act({ action: 'balance', userId: `nobody-${run}@test.dev`, op: 'add', amountBtc: '0.1', note: 'x' })).status, 404);
});

test('balance changes by an admin are bounded, never overdraw, and are logged', async () => {
  const id = `adj${run}@test.dev`;
  assert.ok(await tx((c) => createUser(c, id, {})));
  const balance = async () => {
    const w = await getWallet(id);
    return w.earned - w.withdrawn - w.spent;
  };
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  const ask = (op, amountBtc, note = 'test') => act({ action: 'balance', userId: id, op, amountBtc, note });
  // Refused: bad input changes nothing.
  assert.equal((await ask('give', '1')).status, 400);
  assert.equal((await ask('add', '0')).status, 422);
  assert.equal((await ask('add', '-1')).status, 422);
  assert.equal((await ask('add', 'abc')).status, 422);
  assert.equal((await ask('add', '10.5')).status, 422); // above the cap
  assert.equal((await ask('add', '0.1', '  ')).status, 422); // a note is required
  assert.ok(near(await balance(), 0));

  // Add, then take part of it back.
  assert.ok((await ask('add', '0.5')).ok);
  assert.ok(near(await balance(), 0.5));
  assert.ok((await ask('subtract', '0.2')).ok);
  assert.ok(near(await balance(), 0.3));

  // Taking more than is available is refused, and the balance stays.
  assert.equal((await ask('subtract', '1')).status, 409);
  assert.ok(near(await balance(), 0.3));

  // Adjustments made at the same moment all count, and none overdraws.
  const rs = await many(6, () => ask('add', '0.1'));
  assert.equal(rs.filter((r) => r.ok).length, 6);
  assert.ok(near(await balance(), 0.9));
  const racing = await many(4, () => ask('subtract', '0.4'));
  assert.equal(racing.filter((r) => r.ok).length, 2); // 0.9 covers two, not three
  assert.ok(near(await balance(), 0.1));

  // The user can see them, and each one is in the ledger and the audit log.
  const w = await getWallet(id);
  assert.equal(w.history.filter((h) => h.kind === 'adjustment').length, 10);
  const rows = (await q("SELECT btc FROM ledger WHERE user_id = $1 AND kind = 'adjust'", [id])).rows;
  assert.equal(rows.length, 10);
  assert.ok(near(rows.reduce((s, r) => s + Number(r.btc), 0), 0.1));
  assert.equal(await logOf(id), 10);
});

test('taking a balance allows the buy tolerance and no more', async () => {
  const balanceOf = async (id) => {
    const w = await getWallet(id);
    return w.earned - w.withdrawn - w.spent;
  };
  const fund = async (name) => {
    const id = `${name}${run}@test.dev`;
    assert.ok(await tx((c) => createUser(c, id, {})));
    assert.ok((await act({ action: 'balance', userId: id, op: 'add', amountBtc: '0.5', note: 'fund' })).ok);
    return id;
  };
  const take = (id, amountBtc) => act({ action: 'balance', userId: id, op: 'subtract', amountBtc, note: 'tol' });
  const sats = (n) => (0.5 + n * 1e-8).toFixed(8); // 0.5 BTC plus n satoshis
  assert.equal(TOLERANCE, 2e-6);

  // Exactly the balance, and a little over it but inside the tolerance (100 sats), go through.
  const exact = await fund('tolx');
  assert.ok((await take(exact, sats(0))).ok);
  assert.ok(Math.abs(await balanceOf(exact)) < 1e-9);

  const inside = await fund('toli');
  assert.ok((await take(inside, sats(100))).ok);
  assert.ok(Math.abs(await balanceOf(inside) + 1e-6) < 1e-9);

  // 500 sats over is beyond the tolerance: refused, and nothing changes.
  const beyond = await fund('tolb');
  assert.equal((await take(beyond, sats(500))).status, 409);
  assert.ok(Math.abs((await balanceOf(beyond)) - 0.5) < 1e-9);
  assert.equal((await getWallet(beyond)).history.filter((h) => h.kind === 'adjustment').length, 1);
});

test('the admin overview shows each user\'s available balance, matching their wallet', async () => {
  const id = `ovw${run}@test.dev`;
  assert.ok(await tx((c) => createUser(c, id, {})));
  const shown = async () => (await overview()).users.find((u) => u.id === id)?.available;
  const wallet = async () => {
    const w = await getWallet(id);
    return w.earned - w.withdrawn - w.spent;
  };
  const near = (a, b) => Math.abs(a - b) < 1e-7;

  assert.ok(near(await shown(), 0));
  assert.ok((await act({ action: 'balance', userId: id, op: 'add', amountBtc: '0.5', note: 'test' })).ok);
  assert.ok(near(await shown(), 0.5));
  assert.ok((await act({ action: 'balance', userId: id, op: 'subtract', amountBtc: '0.2', note: 'test' })).ok);
  assert.ok(near(await shown(), 0.3));
  assert.ok(near(await shown(), await wallet()));
  // The screen warns before this, and the server still refuses it.
  assert.equal((await act({ action: 'balance', userId: id, op: 'subtract', amountBtc: '0.4', note: 'test' })).status, 409);
  assert.ok(near(await shown(), 0.3));
});

test('balance changes can be typed in USD, converted at the live rate and logged with it', async () => {
  const id = `usd${run}@test.dev`;
  assert.ok(await tx((c) => createUser(c, id, {})));
  const rate = (await getPrices()).prices.btc;
  assert.ok(rate > 0);
  const btcOf = (usd) => Math.round((usd / rate) * 1e8) / 1e8;
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  const balance = async () => {
    const w = await getWallet(id);
    return w.earned - w.withdrawn - w.spent;
  };
  const ask = (op, extra) => act({ action: 'balance', userId: id, op, note: 'usd test', ...extra });
  // Refused: both amounts, bad or too small USD, above the cap, and no note.
  assert.equal((await ask('add', { amountUsd: '10', amountBtc: '0.1' })).status, 400);
  for (const bad of ['0', '-5', 'abc', '0.001']) assert.equal((await ask('add', { amountUsd: bad })).status, 422, bad);
  assert.equal((await ask('add', { amountUsd: String(rate * 10.5) })).status, 422);
  assert.equal((await act({ action: 'balance', userId: id, op: 'add', amountUsd: '10', note: ' ' })).status, 422);
  assert.ok(near(await balance(), 0));

  // Add $1000 and take $400 back: the balance moves by the BTC each came to at the live rate.
  const added = await ask('add', { amountUsd: '1000' });
  assert.ok(added.ok, JSON.stringify(added));
  assert.equal(added.btc, btcOf(1000));
  assert.equal(added.usd, 1000);
  assert.equal(added.rate, rate);
  assert.ok(near(await balance(), btcOf(1000)));
  const taken = await ask('subtract', { amountUsd: '400.50' });
  assert.ok(taken.ok, JSON.stringify(taken));
  assert.equal(taken.btc, btcOf(400.5));
  assert.ok(near(await balance(), btcOf(1000) - btcOf(400.5)));

  // More than is available is still refused, in USD as in BTC.
  assert.equal((await ask('subtract', { amountUsd: '700' })).status, 409);
  assert.ok(near(await balance(), btcOf(1000) - btcOf(400.5)));

  // The ledger keeps the signed USD, the signed BTC and the rate; the user sees the BTC in their activity.
  const rows = (await q("SELECT btc, usd, ref FROM ledger WHERE user_id = $1 AND kind = 'adjust' ORDER BY id", [id])).rows;
  assert.equal(rows.length, 2);
  assert.equal(Number(rows[0].usd), 1000);
  assert.equal(Number(rows[1].usd), -400.5);
  assert.equal(Number(rows[0].btc), btcOf(1000));
  assert.equal(Number(rows[1].btc), -btcOf(400.5));
  assert.ok(rows[0].ref.startsWith('usd test'));
  assert.ok(rows[0].ref.includes(`at $${rate}/BTC`));
  assert.equal((await getWallet(id)).history.filter((h) => h.kind === 'adjustment').length, 2);
  assert.equal(await logOf(id), 2);

  // The screen gets the rate it previews with.
  assert.equal((await overview()).rate.btc, rate);
});

test('admin can block, unblock, note, sign out, reset 2FA and verify one account', async () => {
  const id = `usr${run}@test.dev`;
  assert.ok(await tx((c) => createUser(c, id, {})));
  const req = (t) => ({ cookies: { get: (name) => (name === auth.COOKIE && t ? { value: t } : undefined) } });
  const op = (o, extra = {}) => act({ action: 'user', userId: id, op: o, ...extra });
  const row = async () => (await overview()).users.find((u) => u.id === id);

  // Bad input and the demo account are refused.
  assert.equal((await op('explode')).status, 400);
  assert.equal((await act({ action: 'user', userId: 'demo', op: 'block' })).ok, false); // 409, or 404 when this database has no demo row
  assert.equal((await act({ action: 'user', userId: `nobody-${run}@test.dev`, op: 'block' })).status, 404);

  // Block: the session stops working at once, unblock brings it back.
  const token = await auth.newSession(id);
  assert.equal(await auth.userId(req(token)), id);
  assert.ok((await op('block')).ok);
  assert.ok((await row()).blocked);
  assert.notEqual(await auth.userId(req(token)), id);
  assert.ok((await op('unblock')).ok);
  assert.equal((await row()).blocked, null);
  assert.equal(await auth.userId(req(token)), id);

  // Sign out everywhere: the old session no longer matches.
  assert.ok((await op('reset-sessions')).ok);
  assert.notEqual(await auth.userId(req(token)), id);
  assert.equal(await auth.userId(req(await auth.newSession(id))), id);

  // Note: saved, trimmed to 200, cleared by an empty note.
  assert.ok((await op('note', { note: 'x'.repeat(300) })).ok);
  assert.equal((await row()).note.length, 200);
  assert.ok((await op('note', { note: '' })).ok);
  assert.equal((await row()).note, '');

  // Two-factor reset needs it to be on.
  assert.equal((await op('reset-2fa')).status, 409);
  await withUser(id, (u) => { u.twofa = { secret: 'x' }; return true; });
  assert.equal((await row()).twofa, true);
  assert.ok((await op('reset-2fa')).ok);
  assert.equal((await row()).twofa, false);

  // Verify and unverify.
  assert.ok((await op('verify')).ok);
  assert.equal((await row()).kyc.status, 'verified');
  assert.ok((await op('unverify')).ok);
  assert.equal((await row()).kyc.status, 'none');
  assert.ok((await logOf(id)) >= 8);
});

test('a blocked account cannot sign in by email or Telegram, and can again once unblocked', async () => {
  // Email: right password, blocked => 403; unblocked => in.
  const id = `blk${run}@test.dev`;
  const pw = 'correct horse 1';
  assert.ok((await auth.signup({ email: id, password: pw })).ok);
  assert.equal((await auth.login({ email: id, password: pw })).status, 200);
  assert.ok((await act({ action: 'user', userId: id, op: 'block' })).ok);
  assert.equal((await auth.login({ email: id, password: pw })).status, 403);
  assert.equal((await auth.login({ email: id, password: 'wrong password 1' })).status, 401); // a wrong password still says nothing about the block
  assert.ok((await act({ action: 'user', userId: id, op: 'unblock' })).ok);
  assert.equal((await auth.login({ email: id, password: pw })).status, 200);

  // Telegram: signed initData for a new account, then the same after a block.
  const was = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
  try {
    const tgId = 7000000 + (Date.now() % 1000000);
    const initData = () => {
      const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: tgId, first_name: 'Blk' }) });
      const check = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
      const key = createHmac('sha256', 'WebAppData').update('test-bot-token').digest();
      p.set('hash', createHmac('sha256', key).update(check).digest('hex'));
      return p.toString();
    };
    const tg = `tg:${tgId}`;
    assert.equal((await auth.telegramLogin(initData(), '')).status, 200);
    assert.ok((await act({ action: 'user', userId: tg, op: 'block' })).ok);
    assert.equal((await auth.telegramLogin(initData(), '')).status, 403);
    assert.ok((await act({ action: 'user', userId: tg, op: 'unblock' })).ok);
    assert.equal((await auth.telegramLogin(initData(), '')).status, 200);
  } finally {
    if (was === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = was;
  }
});
