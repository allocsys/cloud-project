// Trust Wallet payment link for an open invoice: https://link.trustwallet.com/send?coin=<slip44>&address=<to>&amount=<coins>[&token_id=<contract or mint>].
// It opens in the browser first, so it also works where a custom-scheme link is blocked (Telegram, PWA). Returns null for a coin it cannot describe.
import { trimAmount } from './pay-coins.js';

// SLIP-44 ids as Trust Wallet uses them (BNB Chain is Smart Chain, 20000714).
const COIN = { btc: 0, eth: 60, bsc: 20000714, ton: 607 };
const NATIVE = { btc: 'btc', eth: 'eth', bsc: 'bnb', ton: 'ton' };

// The token's contract (EVM) is read from the payment link the gateway made, so it is always the one the invoice uses.
function tokenId(order) {
  const uri = String(order.uri || '');
  return /^ethereum:(0x[0-9a-fA-F]{40})@\d+\/transfer\?/.exec(uri)?.[1] || null;
}

export function trustLink(order) {
  const net = String(order?.network || 'btc');
  const asset = String(order?.asset || 'btc');
  if (!Object.hasOwn(COIN, net)) return null;
  const address = String(order?.address || '');
  const amount = trimAmount(order?.amount);
  if (!address || !/^\d+(\.\d+)?$/.test(amount) || Number(amount) <= 0) return null;
  const q = new URLSearchParams({ coin: String(COIN[net]), address, amount });
  if (asset !== NATIVE[net]) {
    const id = tokenId(order);
    if (!id) return null;
    q.set('token_id', id);
  }
  return `https://link.trustwallet.com/send?${q}`;
}
