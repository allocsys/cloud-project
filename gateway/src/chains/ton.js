// TON network: native TON to ONE fixed receiving address (PAY_ADDR_TON), invoices told apart by exact amount.
// Detection lives in ../ton-explorer.js (toncenter v3 HTTP API). Amounts are in nanoton (9 decimals).
// Only the main network, workchain 0. USDT on TON is a jetton (a token contract): it pays the same address, is read from the
// explorer's jetton transfers (same file) and is told apart by its exact amount like TON.
import { config } from '../config.js';

// Tokens on TON. master = the token's master contract; its address is the token's identity (a fake token has another master).
// USDT: master and 6 decimals checked 20 Nov 2026 against docs.ton.org (Jettons payments processing, Deep links).
export const TON_JETTONS = {
  usdt: { master: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs', decimals: 6 },
};

// CRC16-XMODEM, the checksum inside a user-friendly TON address.
export function crc16(bytes) {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

const BAD = 'Not a valid TON address.';

// { workchain, hash } (hash: 64 lower case hex) of an address in raw form ('0:abc...') or user-friendly form (48 characters, base64 or
// base64url, bounceable 'EQ...' or not 'UQ...'). Throws on anything else, a wrong checksum, a testnet-only address or another workchain.
export function tonParse(address) {
  const s = String(address || '').trim();
  const raw = /^(-?\d{1,3}):([0-9a-fA-F]{64})$/.exec(s);
  if (raw) {
    if (Number(raw[1]) !== 0) throw new Error(BAD);
    return { workchain: 0, hash: raw[2].toLowerCase() };
  }
  if (!/^[A-Za-z0-9+/_-]{48}$/.test(s)) throw new Error(BAD);
  const buf = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (buf.length !== 36) throw new Error(BAD);
  if (buf[0] !== 0x11 && buf[0] !== 0x51) throw new Error(BAD); // bounceable or not, main network
  if (crc16(buf.subarray(0, 34)) !== ((buf[34] << 8) | buf[35])) throw new Error(BAD);
  if (buf.readInt8(1) !== 0) throw new Error(BAD);
  return { workchain: 0, hash: buf.subarray(2, 34).toString('hex') };
}

// The user-friendly form (base64url, 'EQ...' bounceable or 'UQ...' not) of a workchain 0 account hash.
export function tonFriendly(hash, bounceable = false) {
  const body = Buffer.concat([Buffer.from([bounceable ? 0x11 : 0x51, 0]), Buffer.from(String(hash), 'hex')]);
  const c = crc16(body);
  return Buffer.concat([body, Buffer.from([c >> 8, c & 0xff])]).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}

export function tonAddress() {
  const a = config().payAddr.ton;
  try {
    tonParse(a);
    return a;
  } catch {
    return '';
  }
}

export const tonChain = () => ({
  assets: ['ton', ...Object.keys(TON_JETTONS)],
  decimals: 9,
  decimalsOf: (asset) => (asset === 'ton' ? 9 : Object.hasOwn(TON_JETTONS, asset) ? TON_JETTONS[asset].decimals : undefined),
  confirmations: () => config().ton.confirmations,
  recentConfirmations: 1000, // a TON payment shows 0 or 1 confirmation; the explorer's 14 day window is what keeps this recent
  shared: () => true,
  configured: () => !!tonAddress(),
  address: () => tonAddress(),
  // 'ton://transfer/<to>?amount=<nanoton>' (Tonkeeper, Wallet in Telegram, MyTonWallet and others); a token adds '&jetton=<master>'
  // and its amount is in the token's own units. No amount: the plain address.
  uri: (address, amount, asset, atomic) => {
    if (!/^[1-9][0-9]{0,37}$/.test(String(atomic ?? ''))) return address;
    if (asset === 'ton') return `ton://transfer/${address}?amount=${atomic}`;
    return Object.hasOwn(TON_JETTONS, asset) ? `ton://transfer/${address}?jetton=${TON_JETTONS[asset].master}&amount=${atomic}` : address;
  },
});
