// Coins a buyer can pay with through our own gateway (PAY_PROVIDER=gateway). Ids match the gateway's networks and assets.
// Used by the server (to check a choice) and by the pay screens (to draw the coin picker).
export const PAY_NETS = { btc: 'Bitcoin', eth: 'Ethereum', bsc: 'BNB Chain', pol: 'Polygon', trx: 'Tron', sol: 'Solana' };

// asset id -> symbol, and the networks it can be paid on (the first one is the default).
export const PAY_ASSETS = {
  btc: { sym: 'BTC', nets: ['btc'] },
  eth: { sym: 'ETH', nets: ['eth'] },
  bnb: { sym: 'BNB', nets: ['bsc'] },
  pol: { sym: 'POL', nets: ['pol'] },
  trx: { sym: 'TRX', nets: ['trx'] },
  sol: { sym: 'SOL', nets: ['sol'] },
  usdt: { sym: 'USDT', nets: ['trx', 'eth', 'bsc', 'pol', 'sol'] },
  usdc: { sym: 'USDC', nets: ['sol', 'eth', 'bsc', 'pol'] },
};

export const DEFAULT_PAY = { asset: 'btc', net: 'btc' };

// A coin amount without the trailing zeros the gateway pads it with ("346.017000000000000000" -> "346.017"). The value is the same.
// Anything that is not a plain decimal comes back as it is (null and undefined give '').
export function trimAmount(v) {
  const s = String(v ?? '');
  return /^\d+\.\d+$/.test(s) ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

// { asset, net } from a request ({ asset, network }), or null when it is not a coin we take. Nothing given means Bitcoin.
export function payChoice(input) {
  const asset = String(input?.asset ?? DEFAULT_PAY.asset).toLowerCase();
  if (!Object.hasOwn(PAY_ASSETS, asset)) return null;
  const net = input?.network === undefined || input?.network === null ? PAY_ASSETS[asset].nets[0] : String(input.network).toLowerCase();
  return PAY_ASSETS[asset].nets.includes(net) ? { asset, net } : null;
}
