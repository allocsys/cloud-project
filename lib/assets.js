// Placeholder coins, networks, fees and prices. Replace with your API.
import { BTC_USD } from '@/lib/data';

// Charged on the USD value when a withdrawal is paid in anything other than BTC.
export const SWAP_FEE_PCT = 1;

// Deposit addresses here are placeholders. Your backend issues the real ones.
export const NETWORKS = {
  btc: {
    label: 'Bitcoin',
    short: 'BTC',
    confirms: 1,
    uri: 'bitcoin:',
    address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
    pattern: /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,60}$/,
  },
  erc20: {
    label: 'Ethereum',
    short: 'ERC20',
    confirms: 12,
    uri: '',
    address: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
    pattern: /^0x[a-fA-F0-9]{40}$/,
  },
  bep20: {
    label: 'BNB Smart Chain',
    short: 'BEP20',
    confirms: 15,
    uri: '',
    address: '0x4B0897b0513fdC7C541B6d9D7E929C4e5364D2dB',
    pattern: /^0x[a-fA-F0-9]{40}$/,
  },
  trc20: {
    label: 'Tron',
    short: 'TRC20',
    confirms: 20,
    uri: '',
    address: 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf',
    pattern: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
  },
  ton: {
    label: 'TON',
    short: 'TON',
    confirms: 1,
    uri: '',
    address: 'UQBvI0aFLnw2QbZgjMPCLRdtRHxhUyinQudg6sdiohIwg5jL',
    pattern: /^(EQ|UQ)[A-Za-z0-9_-]{46}$/,
  },
};

// usd: price per coin. dec: decimals to show. nets: network id -> flat withdrawal fee in that coin.
// The first network listed is the default.
export const ASSETS = {
  btc: { sym: 'BTC', usd: BTC_USD, dec: 8, nets: { btc: 0.0001 } },
  eth: { sym: 'ETH', usd: 2600, dec: 6, nets: { erc20: 0.002 } },
  bnb: { sym: 'BNB', usd: 620, dec: 5, nets: { bep20: 0.0005 } },
  trx: { sym: 'TRX', usd: 0.27, dec: 2, nets: { trc20: 1 } },
  ton: { sym: 'TON', usd: 3.1, dec: 4, nets: { ton: 0.01 } },
  usdt: { sym: 'USDT', usd: 1, dec: 2, nets: { trc20: 1, bep20: 0.3, erc20: 4 } },
};

// What a withdrawal of `coin` units (gross, in the chosen coin) pays out: swap fee (non-BTC only),
// then the flat network fee. `btc` is what leaves the BTC balance.
export function quote(assetId, netId, coin) {
  const a = ASSETS[assetId];
  const usd = coin * a.usd;
  const swapUsd = assetId === 'btc' ? 0 : (usd * SWAP_FEE_PCT) / 100;
  const netFee = a.nets[netId];
  const receive = (usd - swapUsd) / a.usd - netFee;
  return { usd, swapUsd, netFee, netFeeUsd: netFee * a.usd, receive, receiveUsd: receive * a.usd, btc: usd / BTC_USD };
}

// What a deposit of `amount` coins credits: everything arrives as BTC, so non-BTC coins
// pay the swap fee on their USD value first. Placeholder maths. Replace with your API.
export function depositQuote(assetId, amount) {
  const a = ASSETS[assetId];
  const usd = amount * a.usd;
  const swapUsd = assetId === 'btc' ? 0 : (usd * SWAP_FEE_PCT) / 100;
  return { usd, swapUsd, creditedBtc: (usd - swapUsd) / BTC_USD, creditedUsd: usd - swapUsd };
}
