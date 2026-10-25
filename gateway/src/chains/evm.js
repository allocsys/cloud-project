// EVM networks (Ethereum, BNB Smart Chain, Polygon). All three share ONE receiving address (PAY_ADDR_EVM) and run in fixed-address mode:
// an invoice is told apart by its exact amount. Detection lives in ../evm-scanner.js, which must exist before a network is configured().
//  maxBlocks  the most blocks one scan reads.
//  maxLag     how many blocks behind the scanner may fall before its answers stop being trusted (a stale answer must never expire an invoice).
//  recent     about 14 days of blocks: older payments are history, not unmatched money.
// Token contracts: USDC is from Circle's list. VERIFY USDT against tether.to/en/supported-protocols before going live.
import { config } from '../config.js';

export const EVM = {
  eth: {
    native: 'eth',
    maxBlocks: 50,
    maxLag: 30,
    recent: 100_000,
    tokens: {
      usdt: { contract: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
      usdc: { contract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
    },
  },
  bsc: {
    native: 'bnb',
    maxBlocks: 100,
    maxLag: 120,
    recent: 400_000,
    tokens: {
      usdt: { contract: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
      usdc: { contract: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
    },
  },
  pol: {
    native: 'pol',
    maxBlocks: 100,
    maxLag: 180,
    recent: 600_000,
    tokens: {
      usdt: { contract: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },
      usdc: { contract: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 },
    },
  },
};

// The receiving address, or '' when it is missing or not a well-formed EVM address.
export const evmAddress = () => (/^0x[0-9a-fA-F]{40}$/.test(config().payAddr.evm) ? config().payAddr.evm : '');

export function evmChain(net) {
  const e = EVM[net];
  const dec = { [e.native]: 18 };
  for (const [asset, t] of Object.entries(e.tokens)) dec[asset] = t.decimals;
  return {
    assets: Object.keys(dec),
    decimals: 18,
    decimalsOf: (asset) => dec[asset],
    confirmations: () => config().evm.confirmations[net],
    recentConfirmations: e.recent,
    shared: () => true,
    configured: () => !!evmAddress() && config().evm.networks.includes(net),
    address: () => evmAddress(),
    uri: (address) => address, // plain address: wallets disagree on amount-carrying links for tokens
  };
}
