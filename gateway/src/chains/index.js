// Supported networks. Each entry says which assets it carries, how many confirmations count, and how to make an address and a payment URI.
import { deriveBtcAddress } from './btc.js';
import { config } from '../config.js';

export const CHAINS = {
  btc: {
    assets: ['btc'],
    decimals: 8,
    confirmations: () => config().btcConfirmations,
    configured: () => !!config().btcXpub,
    address: (index) => deriveBtcAddress(config().btcXpub, index),
    uri: (address, amount) => (amount ? `bitcoin:${address}?amount=${amount}` : `bitcoin:${address}`),
  },
};
