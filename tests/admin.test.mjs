// Admin catalogue edits against a real Postgres: concurrent edits queue up, rules hold, the audit log keeps every entry.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, q, tx, createUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const { act, overview } = await import('@/lib/server/admin');
const { getWallet, TOLERANCE } = await import('@/lib/server/wallet');
const { getPrices } = await import('@/lib/server/prices');

const run = `a${Date.now().toString(36)}`;
const each = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));
const many = (n, fn) => Promise.all(each(n, fn));
const catalog = async () => (await q("SELECT data FROM meta WHERE key = 'catalog'")).rows[0]?.data;
const logLen = async () => ((await q("SELECT data FROM meta WHERE key = 'adminlog'")).rows[0]?.data || []).length;
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
  const logBefore = await logLen();
  const rs = await Promise.all(each(8, (i) => act({ action: 'hall-save', hall: hall(`c${i}`) })));
  const okCount = rs.filter((r) => r.ok).length;
  assert.equal(okCount, 8, JSON.stringify(rs.filter((r) => !r.ok)));
  const after = await catalog();
  assert.equal(Object.keys(after.halls).length, Object.keys(before.halls).length + 8);
  assert.equal(Object.hasOwn(after, 'plans'), false, 'no fixed plans in the catalogue');
  assert.equal((await logLen()) - logBefore, okCount);
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
  const logBefore = await logLen();

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
  assert.equal((await logLen()) - logBefore, 10);
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
  const logBefore = await logLen();

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
  assert.equal((await logLen()) - logBefore, 2);

  // The screen gets the rate it previews with.
  assert.equal((await overview()).rate.btc, rate);
});
