// Address checksums (lib/address.js) and the coin rounding helpers (lib/assets.js). Pure functions: no database.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { keccak256, sha256, checkAddress } = await import('@/lib/address');
const { validAddress, floorCoin, ceilCoin } = await import('@/lib/assets');

const hex = (u8) => Buffer.from(u8).toString('hex');
const bytes = (s) => Uint8Array.from(Buffer.from(s, 'utf8'));
// Same address with its last character swapped for a different one.
const bump = (s, a, b) => s.slice(0, -1) + (s.at(-1) === a ? b : a);

test('the hashes match their published test values', () => {
  assert.equal(hex(keccak256(bytes(''))), 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
  assert.equal(hex(keccak256(bytes('abc'))), '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45');
  assert.equal(hex(sha256(bytes('abc'))), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(hex(sha256(bytes(''))), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('EVM: lower or upper case passes, mixed case must match EIP-55', () => {
  for (const a of [
    '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
    '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
    '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB',
    '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb',
  ]) {
    assert.ok(validAddress('erc20', a), a);
    assert.ok(validAddress('bep20', a), a);
    assert.ok(validAddress('erc20', `0x${a.slice(2).toLowerCase()}`), 'all lower case has no checksum');
    assert.ok(validAddress('erc20', `0x${a.slice(2).toUpperCase()}`), 'all upper case has no checksum');
    assert.equal(validAddress('erc20', a.replace(/[a-f]/i, (c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()))), false, 'one flipped letter is a typo');
  }
  assert.equal(validAddress('erc20', '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAe'), false, 'too short');
  assert.equal(validAddress('erc20', '5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'), false, 'no 0x');
});

test('Bitcoin: bech32, bech32m and legacy addresses', () => {
  for (const a of [
    'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    'BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4',
    'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
    'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0',
    '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
    '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy',
  ]) {
    assert.ok(validAddress('btc', a), a);
    assert.equal(validAddress('btc', bump(a, 'q', 'p')), false, `typo in ${a}`);
    assert.equal(validAddress('erc20', a), false, 'not an EVM address');
  }
  assert.equal(validAddress('btc', 'bc1qw508D6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'), false, 'mixed case bech32');
  assert.equal(validAddress('btc', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t'), false, 'cut short');
  assert.equal(validAddress('btc', ''), false);
});

test('Tron addresses need a valid base58 checksum', () => {
  const usdt = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
  assert.ok(validAddress('trc20', usdt));
  assert.equal(validAddress('trc20', bump(usdt, 't', 'u')), false);
  assert.equal(validAddress('trc20', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'), false, 'a Bitcoin address is not a Tron address');
});

test('TON addresses need a valid CRC16', () => {
  const zero = `EQ${'A'.repeat(43)}M9c`; // the all-zero address
  assert.equal(zero.length, 48);
  assert.ok(validAddress('ton', zero));
  assert.equal(validAddress('ton', bump(zero, 'c', 'd')), false);
  // A non-bounceable (UQ) address built here: tag 0x51, workchain 0, 32 bytes, CRC16 of the first 34.
  const raw = [0x51, 0x00, ...Array.from({ length: 32 }, (_, i) => i * 7 + 1)];
  let c = 0;
  for (const x of raw) {
    c ^= x << 8;
    for (let i = 0; i < 8; i += 1) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
  }
  const uq = Buffer.from([...raw, c >> 8, c & 255]).toString('base64url');
  assert.ok(uq.startsWith('UQ') && uq.length === 48, uq);
  assert.ok(validAddress('ton', uq));
  assert.equal(validAddress('ton', bump(uq, 'A', 'B')), false);
});

test('an unknown network or a non-string is never valid', () => {
  assert.equal(validAddress('nope', '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'), false);
  assert.equal(checkAddress('btc', null), false);
  assert.equal(checkAddress('btc', 123), false);
});

test('floorCoin rounds down and ceilCoin rounds up to the coin decimals', () => {
  assert.equal(floorCoin('btc', 0.123456789), 0.12345678);
  assert.equal(ceilCoin('btc', 0.123456781), 0.12345679);
  assert.equal(floorCoin('btc', 0.001), 0.001);
  assert.equal(ceilCoin('btc', 0.001), 0.001);
  assert.equal(floorCoin('usdt', 0.29), 0.29, 'float noise (0.29 * 100) does not drop a cent');
  assert.equal(ceilCoin('usdt', 0.29), 0.29, 'float noise does not add a cent');
  assert.equal(floorCoin('trx', 1.239), 1.23);
  assert.equal(ceilCoin('trx', 1.231), 1.24);
  assert.equal(floorCoin('eth', 0.0123456789), 0.012345);
  assert.equal(floorCoin('btc', 1e-10), 0);
});
