// Tron network: native TRX and USDT (TRC20) to ONE fixed receiving address (PAY_ADDR_TRX), invoices told apart by exact amount.
// Detection lives in ../tron-explorer.js (TronGrid HTTP API). Amounts are in sun (6 decimals) for TRX and for USDT.
// USDT contract, checked 26 Oct 2026 against tether.to/en/supported-protocols: matches.
import { sha256 } from '@noble/hashes/sha256';
import { createBase58check } from '@scure/base';
import { config } from '../config.js';

const b58c = createBase58check(sha256);

export const TRX_TOKENS = {
  usdt: { contract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', decimals: 6 },
};

// The 21-byte form ('41' + 20 bytes, lower case hex) of a base58 Tron address. Throws on anything else.
export function tronHex(address) {
  let raw;
  try {
    raw = b58c.decode(String(address || '').trim());
  } catch {
    throw new Error('Not a valid Tron address.');
  }
  if (raw.length !== 21 || raw[0] !== 0x41) throw new Error('Not a valid Tron address.');
  return Buffer.from(raw).toString('hex');
}

// The receiving address, or '' when it is missing or malformed.
export const trxAddress = () => {
  const a = config().payAddr.trx;
  try {
    tronHex(a);
    return a;
  } catch {
    return '';
  }
};

export const trxChain = () => ({
  assets: ['trx', ...Object.keys(TRX_TOKENS)],
  decimals: 6,
  decimalsOf: () => 6,
  confirmations: () => config().trx.confirmations, // 'confirmed' on TronGrid already means solidified (about 19 blocks)
  recentConfirmations: 400_000, // about 14 days of 3 second blocks
  shared: () => true,
  configured: () => !!trxAddress(),
  address: () => trxAddress(),
  uri: (address) => address,
});
