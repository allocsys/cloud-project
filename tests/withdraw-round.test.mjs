// Withdrawals against a real Postgres: the amount is rounded down to the coin's decimals, an amount that rounds to nothing
// is refused, and an address with a wrong checksum is refused before any balance is reserved.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, q, getUser, withUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const { withdraw } = await import('@/lib/server/wallet');

const run = `r${Date.now().toString(36)}`;
const PW = 'correct horse 1';
const BTC_ADDR = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
const ETH_ADDR = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
let n = 0;
const key = () => `k${run}${(n += 1)}`;

async function funded(name) {
  const id = `${name}-${run}@test.dev`;
  assert.ok((await auth.signup({ email: id, password: PW })).ok);
  await withUser(id, (u) => {
    u.withdrawn = (u.withdrawn || 0) - 0.005;
  });
  return id;
}
const rowOf = async (wid) => (await q('SELECT data FROM withdrawals WHERE id = $1', [wid])).rows[0].data;

before(async () => {
  await migrate();
});

after(async () => {
  await pool().end();
});

test('a BTC amount is cut down to 8 decimals, never rounded up', async () => {
  const id = await funded('btc');
  const r = await withdraw({ asset: 'btc', net: 'btc', amount: 0.00123456789, address: BTC_ADDR }, { userId: id, key: key() });
  assert.ok(r.ok, r.error);
  assert.equal(r.entry.amount, '-0.00123456');
  const row = await rowOf(r.id);
  assert.equal(row.amount, 0.00123456);
  assert.ok(row.receive <= row.amount, 'the payout is not above the amount');
  assert.equal(Number(row.receive.toFixed(8)), row.receive, 'the payout has at most 8 decimals');
});

test('an ETH amount is cut down to 6 decimals and the payout too', async () => {
  const id = await funded('eth');
  const r = await withdraw({ asset: 'eth', net: 'erc20', amount: 0.0123456789, address: ETH_ADDR }, { userId: id, key: key() });
  assert.ok(r.ok, r.error);
  assert.equal(r.entry.amount, '-0.012345');
  const row = await rowOf(r.id);
  assert.equal(row.amount, 0.012345);
  assert.equal(Number(row.receive.toFixed(6)), row.receive, 'the payout has at most 6 decimals');
  assert.equal(r.receive, row.receive);
});

test('an amount that rounds down to nothing is refused', async () => {
  const id = await funded('tiny');
  const before1 = (await getUser(id)).withdrawn;
  const r = await withdraw({ asset: 'btc', net: 'btc', amount: 1e-10, address: BTC_ADDR }, { userId: id, key: key() });
  assert.equal(r.ok, false);
  assert.equal(r.status, 422);
  assert.equal(r.field, 'amount');
  assert.equal((await getUser(id)).withdrawn, before1);
});

test('an address with a wrong checksum is refused and nothing is reserved', async () => {
  const id = await funded('addr');
  const before1 = (await getUser(id)).withdrawn;
  const typo = BTC_ADDR.slice(0, -1) + (BTC_ADDR.at(-1) === 'q' ? 'p' : 'q');
  const flipped = ETH_ADDR.replace('aAeb', 'AAeb');
  for (const [asset, net, address] of [['btc', 'btc', typo], ['eth', 'erc20', flipped], ['btc', 'btc', ETH_ADDR]]) {
    const r = await withdraw({ asset, net, amount: asset === 'btc' ? 0.001 : 0.01, address }, { userId: id, key: key() });
    assert.equal(r.ok, false, address);
    assert.equal(r.status, 422, address);
    assert.equal(r.field, 'address', address);
  }
  assert.equal((await getUser(id)).withdrawn, before1);
  assert.equal((await q('SELECT count(*)::int AS n FROM withdrawals WHERE user_id = $1', [id])).rows[0].n, 0);
});
