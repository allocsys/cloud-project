// Admin catalogue edits against a real Postgres: concurrent edits queue up, rules hold, the audit log keeps every entry.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, q, tx, createUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const { act, overview } = await import('@/lib/server/admin');
const { getWallet } = await import('@/lib/server/wallet');

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

test('halls and plans added at the same moment are all kept, and each is logged', async () => {
  const before = await catalog();
  const logBefore = await logLen();
  const rs = await Promise.all([
    ...each(4, (i) => act({ action: 'hall-save', hall: hall(`c${i}`) })),
    ...each(4, (i) => act({ action: 'plan-save', plan: { name: `P${run}${i}`, th: 10 + i, price: 20 + i, days: 30, hall: 'tx-1' } })),
  ]);
  const okCount = rs.filter((r) => r.ok).length;
  assert.equal(okCount, 8, JSON.stringify(rs.filter((r) => !r.ok)));
  const after = await catalog();
  assert.equal(Object.keys(after.halls).length, Object.keys(before.halls).length + 4);
  assert.equal(after.plans.length, before.plans.length + 4);
  assert.equal(new Set(after.plans.map((p) => p.id)).size, after.plans.length);
  assert.equal((await logLen()) - logBefore, okCount);
});

test('plans moved at the same moment are never lost or duplicated', async () => {
  const before = (await catalog()).plans.map((p) => p.id);
  await many(8, (i) => act({ action: 'plan-move', id: before[i % before.length], dir: i % 2 ? 'up' : 'down' }));
  const after = (await catalog()).plans.map((p) => p.id);
  assert.deepEqual([...after].sort(), [...before].sort());
});

test('a hall is removed only when nothing uses it', async () => {
  assert.equal((await act({ action: 'hall-delete', id: 'tx-1' })).status, 409); // core hall
  assert.equal((await act({ action: 'hall-delete', id: 'nope' })).status, 404);

  assert.ok((await act({ action: 'hall-save', hall: hall('use') })).ok);
  const halls = (await catalog()).halls;
  const id = Object.keys(halls).find((k) => halls[k].name === `T${run}use`);
  assert.ok(id);
  assert.ok((await act({ action: 'plan-save', plan: { name: `U${run}`, th: 5, price: 9, days: 30, hall: id } })).ok);
  assert.equal((await act({ action: 'hall-delete', id })).status, 409); // a plan still uses it

  const plan = (await catalog()).plans.find((p) => p.name === `U${run}`);
  assert.ok((await act({ action: 'plan-delete', id: plan.id })).ok);
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
