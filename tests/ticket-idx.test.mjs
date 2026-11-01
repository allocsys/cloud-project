// Migration 003: the sign-up free-ticket check (referrals.js applyLink) can use an index instead of reading every account.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, q, tx } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');

before(async () => {
  await migrate();
});

after(async () => {
  await pool().end();
});

test('the free-ticket network index exists and the sign-up query can use it', async () => {
  assert.equal((await q("SELECT 1 FROM pg_indexes WHERE indexname = 'users_ticket_net_idx'")).rowCount, 1);
  // The same statement applyLink runs. With table scans switched off the planner must choose the index, which proves the WHERE matches.
  const plan = await tx(async (c) => {
    await c.query('SET LOCAL enable_seqscan = off');
    const r = await c.query("EXPLAIN SELECT 1 FROM users WHERE data->>'netKey' = $1 AND data->>'ticketGot' = 'true' AND id <> $2 LIMIT 1", ['10.0.0.0/24', 'someone']);
    return r.rows.map((x) => x['QUERY PLAN']).join('\n');
  });
  assert.match(plan, /users_ticket_net_idx/);
});
