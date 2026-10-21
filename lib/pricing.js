// Live-linked pricing for ASICs power. A hall's net rate (what one TH/s earns a day after electricity and maintenance)
// is worked out from the live gross hashprice, kept a little below it so the estimate stays honest:
//   net = gross x (1 - PRICE_BUFFER) - electricity - maintenance, never below NET_FLOOR.
// The price formula itself is unchanged (lib/data.js customPlan: price = net x TH x days / 1.06).
import { hallRates } from '@/lib/fees';

export const PRICE_BUFFER = 0.02; // prices sit 2% below the live market
export const NET_FLOOR = 0.004; // USD per TH/s per day: prices never fall below this, whatever the feed says
export const PRICE_REFRESH_MS = 3_600_000; // the live gross used for prices is re-read once an hour

const r5 = (n) => Math.round(n * 1e5) / 1e5;

// The net rate for one hall at a live gross, or the hall's saved net when the hall states no electricity numbers.
export function liveNet(gross, hall) {
  const r = hallRates(hall);
  if (!r || !(gross > 0)) return hall.net;
  return Math.max(NET_FLOOR, r5(gross * (1 - PRICE_BUFFER) - r.elec - r.maint));
}

// A copy of the halls with their net rates replaced by the live-linked ones. With no live gross the halls come back as saved.
export function priceHalls(halls, gross) {
  if (!(gross > 0)) return halls;
  return Object.fromEntries(Object.entries(halls).map(([id, h]) => [id, { ...h, net: liveNet(gross, h) }]));
}
