// Solana: native SOL plus USDC and USDT (SPL tokens) to ONE fixed receiving address (PAY_ADDR_SOL), invoices told apart by exact amount.
// Detection lives in ../sol-explorer.js. SOL has 9 decimals (lamports); the tokens have 6.
// Mints: USDC from Circle's list. VERIFY the USDT mint on tether.to/en/supported-protocols before going live.
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
  uri: (address) => address,
});
