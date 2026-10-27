// Solana: native SOL plus USDC and USDT (SPL tokens) to ONE fixed receiving address (PAY_ADDR_SOL), invoices told apart by exact amount.
// Detection lives in ../sol-explorer.js. SOL has 9 decimals (lamports); the tokens have 6.
// Mints, checked 26 Oct 2026: USDC against Circle's list, USDT against tether.to/en/supported-protocols. Both match.
import { base58 } from '@scure/base';
import { config } from '../config.js';

export const SOL_TOKENS = {
  usdt: { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6 },
  usdc: { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
};

export function isSolAddress(address) {
  try {
    return base58.decode(String(address || '').trim()).length === 32;
  } catch {
    return false;
  }
}

// The receiving address, or '' when it is missing or malformed.
export const solAddress = () => (isSolAddress(config().payAddr.sol) ? config().payAddr.sol : '');

export const solChain = () => ({
  assets: ['sol', ...Object.keys(SOL_TOKENS)],
  decimals: 9,
  decimalsOf: (asset) => (asset === 'sol' ? 9 : SOL_TOKENS[asset].decimals),
  confirmations: () => config().sol.confirmations, // only 'finalized' payments get confirmations at all
  recentConfirmations: 4_000_000, // slots: more than 14 days
  shared: () => true,
  configured: () => !!solAddress(),
  address: () => solAddress(),
  // Solana Pay link 'solana:<to>?amount=<coins>[&spl-token=<mint>]'. No amount: the plain address.
  uri: (address, amount, asset) => {
    const a = /^\d+\.\d+$/.test(String(amount ?? '')) ? String(amount).replace(/0+$/, '').replace(/\.$/, '') : String(amount ?? '');
    if (!/^\d+(\.\d+)?$/.test(a) || Number(a) <= 0) return address;
    const t = SOL_TOKENS[asset];
    return `solana:${address}?amount=${a}${t ? `&spl-token=${t.mint}` : ''}`;
  },
});
