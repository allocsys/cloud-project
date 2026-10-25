// Supported networks. Each entry says which assets it carries, their decimals, how many confirmations count, how to make an address
// and a payment URI.
//  shared()  true: every invoice pays the same fixed address and is told apart by its exact amount (fixed-address mode).
//            false: a fresh address per invoice (extended public key).
//  recentConfirmations  payments older than this are history, not unmatched money.
import { deriveBtcAddress } from './btc.js';
import { EVM, evmChain } from './evm.js';
import { config } from '../config.js';

export const CHAINS = {
  btc: {
    assets: ['btc'],
    decimals: 8,
    decimalsOf: () => 8,
    confirmations: () => config().btcConfirmations,
    recentConfirmations: 1000,
    shared: () => !config().btcXpub,
    configured: () => !!(config().btcXpub || config().payAddr.btc),
    address: (index) => (config().btcXpub ? deriveBtcAddress(config().btcXpub, index) : config().payAddr.btc),
    uri: (address, amount) => (amount ? `bitcoin:${address}?amount=${amount}` : `bitcoin:${address}`),
  },
  ...Object.fromEntries(Object.keys(EVM).map((net) => [net, evmChain(net)])),
};
