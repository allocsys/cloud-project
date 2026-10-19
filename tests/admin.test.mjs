// Admin catalogue edits against a real Postgres: concurrent edits queue up, rules hold, the audit log keeps every entry.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, q } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const { act } = await import('@/lib/server/admin');

const run = `a${Date.now().toString(36)}`;
const many = (n, fn) => Promise.all(Array.from({ length: n }, (_, i) => fn(i)));
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
    ...many(4, (i) => act({ action: 'hall-save', hall: hall(`c${i}`) })),
    ...many(4, (i) => act({ action: 'plan-save', plan: { name: `P${run}${i}`, th: 10 + i, price: 20 + i, days: 30, hall: 'tx-1' } })),
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
});
