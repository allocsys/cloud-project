// The machines behind Smart Mining. Pure (no storage), so it runs on the server and in the browser.
//
// A Smart Mining miner has no hall of its own: each day it runs on the machines of the coin it is picked for (lib/smart.js).
// These are the halls those machines sit in, one per kind of hardware. They are separate from the ASICs power catalogue
// (lib/data.js halls), which is priced per TH/s and edited in admin; nobody buys a size here, so there is nothing to price.
//
// Hall reports (POST /api/telemetry) name the miner by serial, as for ASICs. For a Smart Mining serial `th` is the hashrate
// in the unit of the coin the miner is on that day (TH/s for BTC, GH/s for KAS, MH/s for RVN, KH/s for XMR).
import { dailyUsd } from '@/lib/smart';

export const SMART_HALLS = {
  'sm-asic': {
    name: 'Kristiansand Hall 3',
    place: 'Norway',
    power: 'Hydro, $0.04/kWh',
    efficiency: '12.0 J/TH',
    rig: 'Antminer S21 XP Hyd',
    kind: 'asic',
  },
  'sm-gpu': {
    name: 'Tromsø GPU Hall 1',
    place: 'Norway',
    power: 'Hydro, $0.04/kWh',
    rig: 'GPU rack, 8x RTX 4090',
    kind: 'gpu',
  },
  'sm-cpu': {
    name: 'Reykjavík CPU Hall 1',
    place: 'Iceland',
    power: 'Geothermal and hydro, $0.05/kWh',
    rig: 'AMD EPYC 9654 servers',
    kind: 'cpu',
  },
};

// Which hall mines which coin. A coin the admin adds that is not listed here has no hall (null), so nothing wrong is shown.
const COIN_HALL = { BTC: 'sm-asic', KAS: 'sm-gpu', RVN: 'sm-gpu', XMR: 'sm-cpu' };

// { id, name, place, power, rig, kind } for the coin's hall, or null.
export function smartHallFor(coin) {
  const id = COIN_HALL[coin];
  return id ? { id, ...SMART_HALLS[id] } : null;
}

// The hashrate the miner is contracted for on a coin, in that coin's unit: what it would take to earn the miner's daily
// payout at the reference market (budget x base yield), given `ref`, the coin's USD gross per unit per day when Smart Mining
// was priced. It is the yardstick for uptime: an hour counts as up when the hall reports at least 90% of it.
// Null when the miner is not a Smart Mining miner or the coin has no reference.
export function contractedRate(c, ref) {
  if (!c?.smart) return null;
  const daily = dailyUsd(c.budget, c.baseYield, 1);
  return daily > 0 && Number.isFinite(ref) && ref > 0 ? daily / ref : null;
}

// What a Smart Mining miner runs on for a coin: { coin, hall, unit, rate } or null when it has no hall or no reference.
export function machineOn(c, coin, ref, unit) {
  const hall = smartHallFor(coin);
  const rate = contractedRate(c, ref);
  return hall && rate !== null ? { coin, hall, unit: unit || null, rate } : null;
}
