// Connect wallet on Solana: the unsigned transaction is laid out as the legacy format requires. No database, the RPC is a fake.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base58 } from '@scure/base';
import { buildSolTx } from '../src/sol-tx.js';
import { SOL_TOKENS } from '../src/chains/sol.js';

const addr = (n) => base58.encode(new Uint8Array(32).fill(n));
const FROM = addr(1);
const TO = addr(2);
const BLOCKHASH = base58.encode(new Uint8Array(32).fill(9));
const NOW = Date.parse('2026-10-27T12:00:00Z');
const open = { network: 'sol', asset: 'sol', address: TO, expected_atomic: '1500000000', status: 'pending', expires_at: '2026-10-27T13:00:00Z' };

const rpcFor = (src = [], dst = []) => ({
  call: async (m) => {
    assert.equal(m, 'getLatestBlockhash');
    return { value: { blockhash: BLOCKHASH } };
  },
  batch: async (reqs) =>
    reqs.map((r) => ({ value: r.params[0] === FROM ? src : dst })),
});
const acct = (pubkey, amount) => ({ pubkey, account: { data: { parsed: { info: { tokenAmount: { amount } } } } } });
const le64 = (b, at) => new DataView(b.buffer, b.byteOffset + at, 8).getBigUint64(0, true);

test('SOL: one signature slot, a System Program transfer of the exact lamports', async () => {
  const b = Buffer.from(await buildSolTx(open, FROM, rpcFor(), NOW), 'base64');
  assert.equal(b[0], 1);
  assert.ok(b.subarray(1, 65).every((x) => x === 0));
  const m = b.subarray(65);
  assert.deepEqual([...m.subarray(0, 4)], [1, 0, 1, 3]);
  assert.deepEqual([...m.subarray(4, 36)], new Array(32).fill(1));
  assert.deepEqual([...m.subarray(36, 68)], new Array(32).fill(2));
  assert.deepEqual([...m.subarray(68, 100)], new Array(32).fill(0));
  assert.deepEqual([...m.subarray(100, 132)], new Array(32).fill(9));
  assert.deepEqual([...m.subarray(132, 138)], [1, 2, 2, 0, 1, 12]);
  assert.deepEqual([...m.subarray(138, 142)], [2, 0, 0, 0]);
  assert.equal(le64(m, 142), 1500000000n);
  assert.equal(m.length, 150);
});

test('token: TransferChecked from a token account that holds enough, to ours', async () => {
  const inv = { ...open, asset: 'usdc', expected_atomic: '25000000' };
  const rpc = rpcFor([acct(addr(5), '1000'), acct(addr(6), '30000000')], [acct(addr(7), '0')]);
  const b = Buffer.from(await buildSolTx(inv, FROM, rpc, NOW), 'base64');
  const m = b.subarray(65);
  assert.deepEqual([...m.subarray(0, 4)], [1, 0, 2, 5]);
  assert.deepEqual([...m.subarray(4, 36)], new Array(32).fill(1)); // owner
  assert.deepEqual([...m.subarray(36, 68)], new Array(32).fill(6)); // the account with enough
  assert.deepEqual([...m.subarray(68, 100)], new Array(32).fill(7)); // our account
  assert.deepEqual([...m.subarray(100, 132)], [...base58.decode(SOL_TOKENS.usdc.mint)]);
  assert.equal(base58.encode(m.subarray(132, 164)), 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  assert.deepEqual([...m.subarray(164, 196)], new Array(32).fill(9));
  assert.deepEqual([...m.subarray(196, 205)], [1, 4, 4, 1, 3, 2, 0, 10, 12]);
  assert.equal(le64(m, 205), 25000000n);
  assert.equal(m[213], 6);
  assert.equal(m.length, 214);
});

test('refuses what it cannot build', async () => {
  const fail = async (inv, from, rpc, status) => {
    await assert.rejects(buildSolTx(inv, from, rpc, NOW), (e) => e.status === status);
  };
  await fail(open, 'nope', rpcFor(), 400);
  await fail(null, FROM, rpcFor(), 404);
  await fail({ ...open, network: 'eth' }, FROM, rpcFor(), 400);
  await fail({ ...open, status: 'paid' }, FROM, rpcFor(), 409);
  await fail({ ...open, expires_at: '2026-10-27T11:00:00Z' }, FROM, rpcFor(), 409);
  await fail({ ...open, expected_atomic: null }, FROM, rpcFor(), 409);
  const usdt = { ...open, asset: 'usdt', expected_atomic: '5000000' };
  await fail(usdt, FROM, rpcFor([acct(addr(5), '100')], [acct(addr(7), '0')]), 409); // not enough
  await fail(usdt, FROM, rpcFor([acct(addr(5), '9000000')], []), 503); // we have no token account
});
