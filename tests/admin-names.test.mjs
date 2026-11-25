// The admin Friends and Invite problems rows show a Telegram account as @username, else its Telegram name, else the id.
// Email accounts keep their email.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const referrals = await import('@/lib/server/referrals');

const run = `an${Date.now().toString(36)}`;
const PW = 'correct horse 1';
const tg = (n, data) => pool().query('INSERT INTO users (id, data) VALUES ($1, $2::jsonb)', [`tg:${n}${run.replace(/\D/g, '')}`, JSON.stringify(data)]);
const tgId = (n) => `tg:${n}${run.replace(/\D/g, '')}`;

before(async () => {
  await migrate();
});

after(async () => {
  await pool().end();
});

test('whoLabels: @username first, then the Telegram name, and nothing for email or bare Telegram accounts', async () => {
  await tg(1, { tgUser: 'alice', tgName: 'Alice A' });
  await tg(2, { tgName: 'Bob B' });
  await tg(3, {});
  const mail = `m-${run}@test.dev`;
  const m = await referrals.whoLabels([tgId(1), tgId(2), tgId(3), mail, 'demo']);
  assert.equal(m.get(tgId(1)), '@alice');
  assert.equal(m.get(tgId(2)), 'Bob B');
  assert.equal(m.has(tgId(3)), false);
  assert.equal(m.has(mail), false);
  assert.equal((await referrals.whoLabels([])).size, 0);
});

test('the Friends rows carry the friend and inviter names', async () => {
  await tg(4, { tgUser: 'carol' });
  const friend = `fr-${run}@test.dev`;
  assert.ok((await auth.signup({ email: friend, password: PW })).ok);
  await pool().query('UPDATE users SET ref_by = $1 WHERE id = $2', [tgId(4), friend]);
  const page = await referrals.adminFriendPage({ offset: 0, limit: 200 });
  const row = page.rows.find((r) => r.id === friend);
  assert.ok(row, 'the friend is listed');
  assert.equal(row.name, null, 'an email account has no name, the page shows the email');
  assert.equal(row.inviter, tgId(4));
  assert.equal(row.inviterName, '@carol');
});

test('the Invite problems rows carry the names too', async () => {
  await tg(5, { tgName: 'Dave D' });
  await tg(6, { tgUser: 'erin' });
  await referrals.noteInviteMiss({ id: tgId(5), code: 'VTX-ZZZZ', why: 'full', inviter: tgId(6) });
  const page = await referrals.adminInviteMisses({ offset: 0, limit: 200 });
  const row = page.rows.find((r) => r.id === tgId(5));
  assert.ok(row);
  assert.equal(row.name, 'Dave D');
  assert.equal(row.inviterName, '@erin');
  assert.equal(row.inviter, tgId(6));
});
