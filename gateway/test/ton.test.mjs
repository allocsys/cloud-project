// TON: address parsing, payment link and the toncenter explorer. No network and no database: fetch is a stub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc16, tonParse, tonFriendly, tonChain } from '../src/chains/ton.js';
import { tonExplorer } from '../src/ton-explorer.js';
import { ExplorerError } from '../src/explorer.js';

const isExplorerError = (re) => (e) => e instanceof ExplorerError && re.test(e.message);

const H = 'ab'.repeat(32);
const OTHER = 'cd'.repeat(32);
const UQ = tonFriendly(H); // not bounceable
const EQ = tonFriendly(H, true); // bounceable

// A friendly address with any tag byte and workchain, to try the refusals.
const friendly = (tag, wc, hash) => {
  const body = Buffer.concat([Buffer.from([tag, wc & 0xff]), Buffer.from(hash, 'hex')]);
  const c = crc16(body);
  return Buffer.concat([body, Buffer.from([c >> 8, c & 0xff])]).toString('base64url');
};

test('ton: crc16 matches the XMODEM check value', () => {
  assert.equal(crc16(Buffer.from('123456789')), 0x31c3);
});

test('ton: friendly (both kinds, base64url and base64) and raw forms are the same account', () => {
  assert.match(UQ, /^UQ/);
  assert.match(EQ, /^EQ/);
  const want = { workchain: 0, hash: H };
  assert.deepEqual(tonParse(UQ), want);
  assert.deepEqual(tonParse(EQ), want);
  assert.deepEqual(tonParse(UQ.replace(/-/g, '+').replace(/_/g, '/')), want);
  assert.deepEqual(tonParse(`0:${H.toUpperCase()}`), want);
  assert.deepEqual(tonParse(`  ${UQ}  `), want);
});

test('ton: a bad checksum, length, testnet tag or other workchain is refused', () => {
  const bad = [
    UQ.slice(0, -1) + (UQ.endsWith('A') ? 'B' : 'A'),
    UQ.slice(0, -2),
    `${UQ}A`,
    friendly(0x91, 0, H), // testnet, bounceable
    friendly(0xd1, 0, H), // testnet, not bounceable
    friendly(0x11, -1, H), // masterchain
    `-1:${H}`,
    `1:${H}`,
    '0xd3155961b2C13778345aB8697871C5a2f4b40764',
    'TVQpr1AFM8qbUT1JRbjL8KJDMuqNvP6AEH',
    '',
    null,
    undefined,
  ];
  for (const a of bad) assert.throws(() => tonParse(a), /Not a valid TON address/, String(a));
});

test('ton: configured only with a well-formed address; the payment link carries nanoton', () => {
  const keep = process.env.PAY_ADDR_TON;
  try {
    const ch = tonChain();
    process.env.PAY_ADDR_TON = UQ;
    assert.equal(ch.configured(), true);
    assert.equal(ch.address(5), UQ);
    process.env.PAY_ADDR_TON = '0xd3155961b2C13778345aB8697871C5a2f4b40764';
    assert.equal(ch.configured(), false);
    process.env.PAY_ADDR_TON = '';
    assert.equal(ch.configured(), false);
    assert.deepEqual(ch.assets, ['ton']);
    assert.equal(ch.decimalsOf('ton'), 9);
    assert.equal(ch.shared(), true);
    assert.equal(ch.uri(UQ, '1.5', 'ton', '1500000000'), `ton://transfer/${UQ}?amount=1500000000`);
    assert.equal(ch.uri(UQ, null, 'ton', null), UQ);
    assert.equal(ch.uri(UQ, '0', 'ton', '0'), UQ);
  } finally {
    if (keep === undefined) delete process.env.PAY_ADDR_TON;
    else process.env.PAY_ADDR_TON = keep;
  }
});

// ---------- Explorer ----------
const NOW = 1_700_000_000_000;
const hashB64 = (b) => Buffer.alloc(32, b).toString('base64');
const hashHex = (b) => Buffer.alloc(32, b).toString('hex');
const tx = ({ h = 1, to = H, value = '1500000000', ago = 120_000, bounced = false, aborted = false, ok = true, mc = 5000, external = false, emulated = false } = {}) => ({
  hash: hashB64(h),
  now: Math.floor((NOW - ago) / 1000),
  mc_block_seqno: mc,
  emulated,
  description: { aborted, compute_ph: { success: ok } },
  in_msg: { source: external ? null : `0:${OTHER.toUpperCase()}`, destination: `0:${to.toUpperCase()}`, value, bounced },
});
const fetchOf = (answer, seen = []) => async (url, opts) => {
  seen.push({ url, headers: opts?.headers ?? {} });
  if (answer === 'down') return new Response('no', { status: 500 });
  if (typeof answer === 'string') return new Response(answer);
  return new Response(JSON.stringify({ transactions: answer }));
};
const ton = (answer, extra = {}) => tonExplorer({ baseUrl: 'https://ton.test', fetchImpl: fetchOf(answer), now: () => NOW, ...extra });

test('ton: reads transfers to the address; bounced, external, failed, other and zero ones are skipped', async () => {
  const answer = [
    tx({ h: 1 }),
    tx({ h: 2, mc: null, ago: 5_000, value: '7' }), // young and not in a masterchain block yet
    tx({ h: 3, mc: null, ago: 60_000, value: '9' }), // old enough
    tx({ h: 4, bounced: true }),
    tx({ h: 5, external: true }),
    tx({ h: 6, to: OTHER }),
    tx({ h: 7, aborted: true }),
    tx({ h: 8, ok: false }),
    tx({ h: 9, value: '0' }),
    tx({ h: 10, emulated: true }),
  ];
  assert.deepEqual(await ton(answer).addressPayments(UQ), [
    { txid: hashHex(1), vout: 0, amount: '1500000000', confirmations: 1, height: 5000, asset: 'ton' },
    { txid: hashHex(2), vout: 0, amount: '7', confirmations: 0, height: null, asset: 'ton' },
    { txid: hashHex(3), vout: 0, amount: '9', confirmations: 1, height: null, asset: 'ton' },
  ]);
  // the same account in the other address form is found as well
  assert.equal((await ton(answer).addressPayments(EQ)).length, 3);
});

test('ton: a hex hash passes through, and the key goes in a header never in the URL', async () => {
  const seen = [];
  const ex = tonExplorer({ baseUrl: 'https://ton.test/', apiKey: 'k-123', fetchImpl: fetchOf([{ ...tx({ h: 1 }), hash: hashHex(1).toUpperCase() }], seen), now: () => NOW });
  const got = await ex.addressPayments(UQ);
  assert.equal(got[0].txid, hashHex(1));
  assert.equal(seen.length, 1);
  assert.ok(seen[0].url.startsWith('https://ton.test/api/v3/transactions?account='));
  assert.ok(seen[0].url.includes('sort=desc'));
  assert.equal(seen[0].headers['X-API-Key'], 'k-123');
  assert.ok(!seen[0].url.includes('k-123'));
});

test('ton: a failing or broken answer throws instead of looking like no payments', async () => {
  await assert.rejects(ton('down').addressPayments(UQ), isExplorerError(/500/));
  await assert.rejects(ton('not json').addressPayments(UQ), isExplorerError(/invalid JSON/));
  await assert.rejects(ton('{"x":1}').addressPayments(UQ), isExplorerError(/unexpected/));
  await assert.rejects(ton([{ ...tx(), hash: 'bad' }]).addressPayments(UQ), isExplorerError(/malformed/));
  await assert.rejects(ton([{ ...tx(), description: undefined }]).addressPayments(UQ), isExplorerError(/malformed/));
  await assert.rejects(ton([{ ...tx(), in_msg: { ...tx().in_msg, destination: 'nope' } }]).addressPayments(UQ), isExplorerError(/malformed/));
  await assert.rejects(ton([tx({ value: 'x' })]).addressPayments(UQ), isExplorerError(/malformed/));
  assert.throws(() => tonExplorer({ baseUrl: 'http://ton.test' }), /https/);
});
