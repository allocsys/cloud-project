// Free invite tickets, against a real Postgres: a sign-up with a code gives the friend and the inviter one free boost ticket each,
// only from a network that has not had one, only up to the inviter's cap, and only while Boost tickets are on.
// Settings changed here are put back in the after hook, so other test files see the defaults.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, getUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const referrals = await import('@/lib/server/referrals');
const { act } = await import('@/lib/server/admin');

const run = `r${Date.now().toString(36)}`;
const PW = 'correct horse 1';
const rnd = () => Math.floor(Math.random() * 200) + 20;
// A fresh /24 per call, so networks never repeat between tests or runs.
const net = () => `${rnd()}.${rnd()}.${rnd()}.7`;
// Invite tickets are held in the account (u.freeTickets) until the user starts them, so this gives one entry per held ticket.
const gifts = (u) => Array.from({ length: u.freeTickets || 0 });

async function account(name, ip, ref = '') {
  const e = `${name}-${run}@test.dev`;
  assert.ok((await auth.signup({ email: e, password: PW, ref }, ip)).ok);
  return e;
}
const codeOf = async (id) => (await getUser(id)).refCode;
const on = () => act({ action: 'boost-settings', enabled: true, chance: { t1: 0, t10: 0, t100: 0 } });

before(async () => {
  await migrate();
});

after(async () => {
  await act({ action: 'boost-settings', enabled: false, chance: { t1: 5, t10: 5, t100: 5 }, shown: { t1: '', t10: '', t100: '' } });
  await referrals.resetSettings();
  await pool().end();
});

test('a sign-up with a code gives the friend and the inviter one free ticket each', async () => {
  assert.equal((await on()).ok, true);
  const inv = await account('inv1', net());
  const fr = await account('fr1', net(), await codeOf(inv));
  const i = await getUser(inv);
  const f = await getUser(fr);
  assert.equal(gifts(i).length, 1);
  assert.equal(gifts(f).length, 1);
  assert.equal(i.refTickets, 1);
  assert.equal(f.ticketGot, true);
});

test('no ticket from the inviter\'s own network, or from a network that already got one', async () => {
  assert.equal((await on()).ok, true);
  const home = net();
  const inv = await account('inv2', home);
  const same = await account('fr2a', home, await codeOf(inv));
  assert.equal(gifts(await getUser(same)).length, 0, 'same network as the inviter');
  assert.equal(gifts(await getUser(inv)).length, 0);

  const other = net();
  const a = await account('fr2b', other, await codeOf(inv));
  assert.equal(gifts(await getUser(a)).length, 1);
  const b = await account('fr2c', other, await codeOf(inv));
  assert.equal(gifts(await getUser(b)).length, 0, 'that network already got one');
  assert.equal((await getUser(inv)).refTickets, 1);
});

test('an unknown network gets no ticket', async () => {
  assert.equal((await on()).ok, true);
  const inv = await account('inv3', net());
  const fr = await account('fr3', '', await codeOf(inv));
  assert.equal(gifts(await getUser(fr)).length, 0);
  assert.equal(gifts(await getUser(inv)).length, 0);
});

test('the inviter stops getting tickets at the cap', async () => {
  assert.equal((await on()).ok, true);
  assert.equal((await referrals.saveSettings({ ticketCap: 1 })).ok, true);
  const inv = await account('inv4', net());
  const code = await codeOf(inv);
  const a = await account('fr4a', net(), code);
  const b = await account('fr4b', net(), code);
  assert.equal(gifts(await getUser(a)).length, 1);
  assert.equal(gifts(await getUser(b)).length, 0, 'cap reached');
  assert.equal(gifts(await getUser(inv)).length, 1);
  assert.equal((await getUser(inv)).refTickets, 1);
  await referrals.resetSettings();
});

test('no tickets while Boost tickets are off or the cap is 0', async () => {
  await act({ action: 'boost-settings', enabled: false, chance: { t1: 0, t10: 0, t100: 0 } });
  const inv = await account('inv5', net());
  const a = await account('fr5a', net(), await codeOf(inv));
  assert.equal(gifts(await getUser(a)).length, 0);
  assert.equal(gifts(await getUser(inv)).length, 0);

  assert.equal((await on()).ok, true);
  assert.equal((await referrals.saveSettings({ ticketCap: 0 })).ok, true);
  const b = await account('fr5b', net(), await codeOf(inv));
  assert.equal(gifts(await getUser(b)).length, 0);
  await referrals.resetSettings();
});
