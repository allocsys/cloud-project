// Admin catalogue edits against a real Postgres: concurrent edits queue up, rules hold, the audit log keeps every entry.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

const { pool, q, tx, createUser, withUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const { act, overview, flaggedUsers, FLAG, BULK_MAX } = await import('@/lib/server/admin');
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

test('admin can pause and allow withdrawals for one account, and sees its activity rows', async () => {
  const { withdraw } = await import('@/lib/server/wallet');
  const id = `frz${run}@test.dev`;
  assert.ok(await tx((c) => createUser(c, id, {})));
  const row = async () => (await overview()).users.find((u) => u.id === id);
  const ask = () => withdraw({ asset: 'btc', net: 'btc', amount: 0.001, address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh' }, { userId: id, key: `f${Date.now()}${Math.random()}` });

  // Not paused: the request gets as far as the balance check.
  assert.equal((await ask()).status, 409);
  assert.equal((await row()).frozen, null);

  // Paused: refused before anything else, and the account still signs in.
  assert.ok((await act({ action: 'user', userId: id, op: 'freeze' })).ok);
  assert.ok((await row()).frozen);
  assert.equal((await ask()).status, 403);
  assert.ok(await auth.newSession(id));
  assert.equal((await act({ action: 'user', userId: 'demo', op: 'freeze' })).ok, false);

  // Allowed again.
  assert.ok((await act({ action: 'user', userId: id, op: 'unfreeze' })).ok);
  assert.equal((await row()).frozen, null);
  assert.equal((await ask()).status, 409);

  // Activity rows: a balance change shows up, newest first, at most 25.
  assert.ok((await act({ action: 'balance', userId: id, op: 'add', amountBtc: '0.001', note: 'history test' })).ok);
  const h = (await row()).history;
  assert.ok(h.length >= 1 && h.length <= 25);
  assert.equal(h[0].kind, 'adjustment');
  assert.match(h[0].amount, /^\+0\.001/);
});

test('admin can message one user and gift a free miner or free boost tickets', async () => {
  const id = `gft${run}@test.dev`;
  assert.ok(await tx((c) => createUser(c, id, {})));
  const row = async () => (await overview()).users.find((u) => u.id === id);
  const read = (fn) => withUser(id, (u) => fn(u));
  const gift = (extra) => act({ action: 'gift', userId: id, ...extra });

  // A message to one user reaches only that user.
  const sent = await act({ action: 'notify', userId: id, title: `Hello ${run}`, body: 'Hi there' });
  assert.ok(sent.ok);
  assert.equal(sent.sent, 1);
  assert.ok(await read((u) => u.notifications.some((n) => n.title === `Hello ${run}`)));
  assert.equal((await act({ action: 'notify', userId: id, title: '  ' })).status, 422);

  // Free miner: bad input and the demo account are refused, a good one is a gift miner (bonus, no price).
  assert.equal((await gift({ kind: 'what' })).status, 400);
  for (const bad of [{ th: '0', days: '30' }, { th: '5000', days: '30' }, { th: 'abc', days: '30' }, { th: '5', days: '0' }, { th: '5', days: '400' }]) {
    assert.equal((await gift({ kind: 'miner', ...bad })).status, 422, JSON.stringify(bad));
  }
  assert.equal((await act({ action: 'gift', userId: 'demo', kind: 'miner', th: '5', days: '30' })).ok, false);
  assert.equal((await row()).miners.length, 0);
  const m = await gift({ kind: 'miner', th: '5', days: '30' });
  assert.ok(m.ok, JSON.stringify(m));
  const own = await read((u) => u.contracts.map((c) => ({ serial: c.serial, bonus: c.bonus, price: c.price, th: c.th, days: c.days })));
  assert.equal(own.length, 1);
  assert.deepEqual(own[0], { serial: m.serial, bonus: true, price: 0, th: 5, days: 30 });
  assert.equal((await row()).miners.length, 1);
  // A gift miner has nothing to refund.
  assert.equal((await act({ action: 'miner', userId: id, serial: m.serial, op: 'refund' })).status, 409);

  // Free tickets need boost tickets to be on; the count is 1 to 10.
  const wasOn = (await q("SELECT data FROM meta WHERE key = 'boost'")).rows[0]?.data?.enabled === true;
  try {
    assert.ok((await act({ action: 'boost-settings', enabled: false })).ok);
    assert.equal((await gift({ kind: 'tickets', count: '2' })).status, 409);
    assert.ok((await act({ action: 'boost-settings', enabled: true })).ok);
    for (const bad of ['0', '11', 'abc']) assert.equal((await gift({ kind: 'tickets', count: bad })).status, 422, bad);
    const t = await gift({ kind: 'tickets', count: '3' });
    assert.ok(t.ok, JSON.stringify(t));
    assert.equal(t.count, 3);
    const boosts = await read((u) => (u.boosts || []).map((b) => ({ t: b.t, gift: b.gift, settled: b.settled })));
    assert.equal(boosts.length, 3);
    assert.ok(boosts.every((b) => b.t === 't1' && b.gift === true && b.settled === false));
    assert.equal((await row()).boostsRunning, 3);
  } finally {
    await act({ action: 'boost-settings', enabled: wasOn });
  }
  assert.ok((await logOf(id)) >= 3);
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

test('admin can set a new password, and set or remove the inviter', async () => {
  const id = `pwd${run}@test.dev`;
  const inv = `inv${run}@test.dev`;
  const old = 'old password 1';
  const next = 'new password 22';
  assert.ok((await auth.signup({ email: id, password: old })).ok);
  assert.ok((await auth.signup({ email: inv, password: old })).ok);
  const own = (fn) => withUser(id, (u) => fn(u));
  const pass = (extra) => act({ action: 'user', userId: id, op: 'set-password', ...extra });

  // Password: too short, the demo account and a Telegram account are refused; a good one replaces the old and ends old sessions.
  assert.equal((await pass({ password: 'short' })).status, 422);
  assert.equal((await act({ action: 'user', userId: 'demo', op: 'set-password', password: next })).ok, false);
  const tg = `tg:${8000000 + (Date.now() % 1000000)}`;
  assert.ok(await tx((c) => createUser(c, tg, {})));
  assert.equal((await act({ action: 'user', userId: tg, op: 'set-password', password: next })).status, 409);
  const before = await own((u) => u.pwAt || 0);
  assert.ok((await pass({ password: next })).ok);
  assert.ok((await own((u) => u.pwAt || 0)) > before);
  assert.equal((await auth.login({ email: id, password: old })).status, 401);
  assert.equal((await auth.login({ email: id, password: next })).status, 200);
  assert.ok(await own((u) => u.notifications.some((n) => n.title === 'Password changed')));
  assert.equal(await logOf(next), 0, 'the password is never written to the audit log');

  // Inviter: unknown, empty and itself are refused; a good one links both the document and the ref_by column.
  const ref = (extra) => act({ action: 'user', userId: id, op: 'ref-set', ...extra });
  const refBy = () => own((u) => u.refBy || null);
  const column = async () => (await q('SELECT ref_by FROM users WHERE id = $1', [id])).rows[0].ref_by;
  assert.equal((await ref({ inviter: `nobody${run}@test.dev` })).status, 404);
  assert.equal((await ref({ inviter: id })).status, 409);
  assert.equal((await ref({ inviter: '' })).status, 422);
  assert.ok((await ref({ inviter: inv })).ok);
  assert.equal(await refBy(), inv);
  assert.equal(await column(), inv);
  // The inviter cannot be linked under their own friend: that would be a circle.
  assert.equal((await act({ action: 'user', userId: inv, op: 'ref-set', inviter: id })).status, 409);

  // Remove, then link again by the inviter's invite code.
  assert.ok((await act({ action: 'user', userId: id, op: 'ref-clear' })).ok);
  assert.equal(await refBy(), null);
  assert.equal(await column(), null);
  assert.equal((await act({ action: 'user', userId: id, op: 'ref-clear' })).status, 409);
  const code = await withUser(inv, (u) => u.refCode);
  assert.ok(code);
  assert.ok((await ref({ inviter: code.toLowerCase() })).ok);
  assert.equal(await refBy(), inv);
  assert.ok((await overview()).users.find((u) => u.id === id).hasPw);
});

test('flagged users: same network, invite burst, quick withdrawal and many open withdrawals', () => {
  const T = 1_700_000_000_000;
  const h = 3600000;
  const mk = (id, extra = {}) => ({ id, createdAt: T, history: [], ...extra });

  // Same network: three or more share a key; two do not. Test friends, the demo account and closed accounts never count.
  const net = flaggedUsers([mk('a', { netKey: 'k1' }), mk('b', { netKey: 'k1' }), mk('c', { netKey: 'k1' }), mk('d', { netKey: 'k2' }), mk('e', { netKey: 'k2' })]);
  assert.deepEqual([...net.keys()].sort(), ['a', 'b', 'c']);
  assert.deepEqual(net.get('a'), ['Same network ×3']);
  const skipped = flaggedUsers([mk('a', { netKey: 'k1' }), mk('b', { netKey: 'k1' }), mk('friend1@test', { netKey: 'k1' }), mk('demo', { netKey: 'k1' }), mk('z', { netKey: 'k1', closedAt: T })]);
  assert.equal(skipped.size, 0);

  // Invite burst: four friends of one inviter inside an hour; four spread over hours, or three inside an hour, are fine.
  const friends = (n, gap) => Array.from({ length: n }, (_, i) => mk(`f${n}-${gap}-${i}`, { refBy: 'boss', createdAt: T + i * gap }));
  assert.equal(FLAG.burstN, 4);
  const burst = flaggedUsers(friends(4, 10 * 60000));
  assert.equal(burst.size, 4);
  assert.ok([...burst.values()].every((l) => l.length === 1 && l[0] === 'Invite burst'));
  assert.equal(flaggedUsers(friends(4, 2 * h)).size, 0);
  assert.equal(flaggedUsers(friends(3, 10 * 60000)).size, 0);

  // Quick withdrawal: within 48 hours of joining flags, three days later does not.
  const wd = (after) => [{ kind: 'withdrawal', at: T + after }];
  assert.deepEqual(flaggedUsers([mk('q', { history: wd(h) })]).get('q'), ['Quick withdrawal']);
  assert.equal(flaggedUsers([mk('q', { history: wd(72 * h) })]).size, 0);
  assert.equal(flaggedUsers([mk('q', { history: [{ kind: 'purchase', at: T + h }] })]).size, 0);

  // Many open withdrawals: three or more at once.
  assert.deepEqual(flaggedUsers([mk('o')], new Map([['o', 3]])).get('o'), ['3 withdrawals open']);
  assert.equal(flaggedUsers([mk('o')], new Map([['o', 2]])).size, 0);

  // One user can carry several flags.
  const both = flaggedUsers([mk('m', { history: wd(h) })], new Map([['m', 4]]));
  assert.deepEqual(both.get('m'), ['Quick withdrawal', '4 withdrawals open']);
});

test('the admin overview carries each user\'s flags', async () => {
  const key = `k${run}`;
  const ids = each(3, (i) => `net${i}${run}@test.dev`);
  for (const id of ids) {
    assert.ok(await tx((c) => createUser(c, id, {})));
    await withUser(id, (u) => { u.netKey = key; return true; });
  }
  const users = (await overview()).users;
  for (const id of ids) assert.deepEqual(users.find((u) => u.id === id).flags, ['Same network ×3']);
  // A user nobody flagged has an empty list.
  const calm = `calm${run}@test.dev`;
  assert.ok(await tx((c) => createUser(c, calm, {})));
  assert.deepEqual((await overview()).users.find((u) => u.id === calm).flags, []);
});

test('bulk actions: bad input is refused, and each user goes through the single-user rules', async () => {
  const ids = each(3, (i) => `blk${i}${run}@test.dev`);
  for (const id of ids) assert.ok(await tx((c) => createUser(c, id, {})));
  const ghost = `ghost${run}@test.dev`;
  const bulk = (extra) => act({ action: 'bulk', ...extra });
  const rows = async () => (await overview()).users.filter((u) => ids.includes(u.id));
  const t0 = Date.now();

  // Refused before anything changes.
  assert.equal((await bulk({ op: 'block' })).status, 422); // no ids
  assert.equal((await bulk({ op: 'block', ids: [] })).status, 422);
  assert.equal((await bulk({ op: 'block', ids: ['demo', 'all', ''] })).status, 422); // demo and 'all' are skipped, so nothing is left
  assert.equal((await bulk({ op: 'explode', ids })).status, 400);
  assert.equal((await bulk({ op: 'block', ids: each(BULK_MAX + 1, (i) => `x${i}@test.dev`) })).status, 422);
  assert.ok((await rows()).every((u) => !u.blocked));

  // Block three real users, one unknown id and the demo account: three done, one refused and named.
  const r = await bulk({ op: 'block', ids: [...ids, ghost, 'demo'] });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.done, 3);
  assert.equal(r.failed, 1);
  assert.ok(r.errors[0].startsWith(ghost) && r.errors[0].includes('User not found'), r.errors[0]);
  assert.ok((await rows()).every((u) => u.blocked));
  assert.ok((await bulk({ op: 'unblock', ids })).ok);
  assert.ok((await rows()).every((u) => !u.blocked));

  // The same id twice counts once.
  assert.equal((await bulk({ op: 'freeze', ids: [ids[0], ids[0]] })).done, 1);
  assert.ok((await rows())[0].frozen);
  assert.equal((await bulk({ op: 'freeze', ids })).done, 3);
  assert.ok((await rows()).every((u) => u.frozen));
  assert.equal((await bulk({ op: 'unfreeze', ids })).done, 3);
  assert.ok((await rows()).every((u) => !u.frozen));

  // Message: a title is needed for each; a good one reaches every picked user and nobody else.
  const noTitle = await bulk({ op: 'notify', ids, title: '  ' });
  assert.equal(noTitle.done, 0);
  assert.equal(noTitle.failed, 3);
  const msg = await bulk({ op: 'notify', ids, title: `Bulk ${run}`, body: 'Hello' });
  assert.equal(msg.done, 3);
  for (const id of ids) assert.ok(await withUser(id, (u) => u.notifications.some((n) => n.title === `Bulk ${run}`)));
  assert.ok(!(await withUser(`calm${run}@test.dev`, (u) => u.notifications.some((n) => n.title === `Bulk ${run}`))));

  // Tickets: a bad count is refused for each user; a good one gives each user their gift tickets while boosts are on.
  const bad = await bulk({ op: 'tickets', ids, count: '0' });
  assert.equal(bad.done, 0);
  assert.equal(bad.failed, 3);
  const wasOn = (await q("SELECT data FROM meta WHERE key = 'boost'")).rows[0]?.data?.enabled === true;
  try {
    assert.ok((await act({ action: 'boost-settings', enabled: true })).ok);
    const t = await bulk({ op: 'tickets', ids, count: '2' });
    assert.equal(t.done, 3, JSON.stringify(t));
    for (const id of ids) assert.equal(await withUser(id, (u) => (u.boosts || []).filter((b) => b.gift === true).length), 2);
  } finally {
    await act({ action: 'boost-settings', enabled: wasOn });
  }

  // The audit log names the action and how many users it touched.
  const log = (await q("SELECT data FROM meta WHERE key = 'adminlog'")).rows[0]?.data || [];
  assert.ok(log.some((e) => e.action === 'bulk' && e.at >= t0 && e.detail.includes('3 users')));
});

test('admin can close an account: refused with a balance, then erased, hidden and its friends kept', async () => {
  const id = `cls${run}@test.dev`;
  const friend = `clf${run}@test.dev`;
  const pw = 'correct horse 1';
  assert.ok((await auth.signup({ email: id, password: pw })).ok);
  assert.ok((await auth.signup({ email: friend, password: pw })).ok);
  assert.ok((await act({ action: 'user', userId: friend, op: 'ref-set', inviter: id })).ok);
  const close = (extra = {}) => act({ action: 'user-close', userId: id, ...extra });
  const listed = async (who) => (await overview()).users.some((u) => u.id === who);
  const exists = async (who) => (await q('SELECT 1 FROM users WHERE id = $1', [who])).rowCount === 1;

  // Refused: no confirmation word, the wrong word, an unknown user and the demo account.
  assert.equal((await close()).status, 422);
  assert.equal((await close({ confirm: 'delete me' })).status, 422);
  assert.equal((await act({ action: 'user-close', userId: `nobody${run}@test.dev`, confirm: 'DELETE' })).status, 404);
  assert.equal((await act({ action: 'user-close', userId: 'demo', confirm: 'DELETE' })).ok, false);
  assert.ok(await listed(id));

  // A balance above the withdrawal minimum would be lost: refused, and nothing changes.
  assert.ok((await act({ action: 'balance', userId: id, op: 'add', amountBtc: '0.01', note: 'close test' })).ok);
  const held = await close({ confirm: 'DELETE' });
  assert.equal(held.status, 409);
  assert.match(held.error, /still has/);
  assert.ok(await listed(id));
  assert.ok(await exists(id));
  assert.equal((await auth.login({ email: id, password: pw })).status, 200);

  // With the balance taken back and a gift miner running, it closes; the miner is given up.
  assert.ok((await act({ action: 'balance', userId: id, op: 'subtract', amountBtc: '0.01', note: 'close test' })).ok);
  assert.ok((await act({ action: 'gift', userId: id, kind: 'miner', th: '5', days: '30' })).ok);
  const r = await close({ confirm: ' delete ' }); // the word is not case sensitive and is trimmed
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.miners, 1);

  // Gone: the old id has no row, the list hides the closed account, nobody can sign in to it, and a second close finds nothing.
  assert.equal(await exists(id), false);
  assert.ok(!(await overview()).users.some((u) => String(u.id).startsWith('closed:')));
  assert.notEqual((await auth.login({ email: id, password: pw })).status, 200);
  assert.equal((await close({ confirm: 'DELETE' })).status, 404);

  // The friend stays, and now points at the closed account instead of the erased id.
  assert.ok(await listed(friend));
  const by = await withUser(friend, (u) => u.refBy || null);
  assert.ok(by && by.startsWith('closed:'), String(by));
  assert.ok((await logOf(id)) >= 4);
});
