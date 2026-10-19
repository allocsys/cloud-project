// Supported networks. Each entry says which assets it carries and how to make an address and a payment URI.
import { deriveBtcAddress } from './btc.js';
import { config } from '../config.js';

export const CHAINS = {
  btc: {
    assets: ['btc'],
    decimals: 8,
    configured: () => !!config().btcXpub,
    address: (index) => deriveBtcAddress(config().btcXpub, index),
    uri: (address, amount) => (amount ? `bitcoin:${address}?amount=${amount}` : `bitcoin:${address}`),
  },
};
