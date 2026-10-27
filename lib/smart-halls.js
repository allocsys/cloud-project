// The machines behind Smart Mining. Pure (no storage), so it runs on the server and in the browser.
//
// A Smart Mining miner has no hall of its own: each day it runs on the machines of the coin it is picked for (lib/smart.js).
// These are the halls those machines sit in, one per kind of hardware (Kaspa has its own ASIC hall: its ASICs are not the
// Bitcoin ones). They are separate from the ASICs power catalogue
// (lib/data.js halls), which is priced per TH/s and edited in admin; nobody buys a size here, so there is nothing to price.
//
// Hall reports (POST /api/telemetry) name the miner by serial, as for ASICs. For a Smart Mining serial `th` is the hashrate
// in the unit of the coin the miner is on that day (TH/s for BTC, GH/s for KAS, MH/s for RVN and ETC, KH/s for XMR).
import { dailyUsd, ratioOf, pickCoin } from '@/lib/smart';
import { GROSS_PER_TH_DAY } from '@/lib/fees';

const DAY = 86400000;
const utcDay = (t) => Math.floor(t / DAY) * DAY;

export const SMART_HALLS = {
  'sm-asic': {
    name: 'Kristiansand Hall 3',
    place: 'Norway',
    power: 'Hydro, $0.04/kWh',
    efficiency: '12.0 J/TH',
    rig: 'Antminer S21 XP Hyd',
    kind: 'asic',
  },
  'sm-kas': {
    name: 'Kristiansand Hall 4',
    place: 'Norway',
    power: 'Hydro, $0.04/kWh',
    efficiency: '77 J/TH',
    rig: 'Antminer KS7',
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

// The details the admin can edit (the ASIC hall also states its efficiency), with the longest text each takes. The id and kind
// of a hall are fixed, because which coin runs where depends on them.
export const SMART_HALL_FIELDS = { name: 40, place: 40, power: 60, rig: 40 };
export const SMART_HALL_ASIC_FIELDS = { ...SMART_HALL_FIELDS, efficiency: 20 };
export const smartHallFields = (id) => (SMART_HALLS[id]?.kind === 'asic' ? SMART_HALL_ASIC_FIELDS : SMART_HALL_FIELDS);

// The halls with the admin's saved details laid over the defaults. `saved` is { [id]: { name, place, ... } } or nothing; an
// unknown id, a field that is not editable and anything that is not a non-empty text are ignored, so a bad save can never
// blank a hall out.
export function mergeSmartHalls(saved) {
  const out = {};
  for (const [id, base] of Object.entries(SMART_HALLS)) {
    const over = {};
    const s = saved && typeof saved === 'object' ? saved[id] : null;
    for (const [k, max] of Object.entries(smartHallFields(id))) {
      const v = typeof s?.[k] === 'string' ? s[k].trim().slice(0, max) : '';
      if (v) over[k] = v;
    }
    out[id] = { ...base, ...over };
  }
  return out;
}

// Which hall mines which coin. A coin the admin adds that is not listed here has no hall (null), so nothing wrong is shown.
const COIN_HALL = { BTC: 'sm-asic', KAS: 'sm-kas', RVN: 'sm-gpu', ETC: 'sm-gpu', XMR: 'sm-cpu' };

// { id, name, place, power, rig, kind } for the coin's hall, or null. `halls` are the saved halls (mergeSmartHalls), the defaults when omitted.
export function smartHallFor(coin, halls = SMART_HALLS) {
  const id = COIN_HALL[coin];
  const h = id ? halls?.[id] || SMART_HALLS[id] : null;
  return h ? { id, ...h } : null;
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
export function machineOn(c, coin, ref, unit, halls) {
  const hall = smartHallFor(coin, halls);
  const rate = contractedRate(c, ref);
  return hall && rate !== null ? { coin, hall, unit: unit || null, rate } : null;
}

// The coin of a UTC day, from sm = market.smart ({ picks, refs, live, prev }): the locked pick of a finished day, today's live
// best held inside the hysteresis, or null when there is none (the day is not known).
export function coinOfDay(sm, day, today) {
  if (!sm) return null;
  if (sm.picks?.[day]) return sm.picks[day];
  if (day !== today) return null;
  const ratios = {};
  for (const [coin, g] of Object.entries(sm.live || {})) ratios[coin] = ratioOf(g, sm.refs?.[coin]);
  return pickCoin(ratios, sm.prev ?? null) || sm.prev || null;
}

// The contracted hashrate of a Smart Mining miner during the hour starting at hourMs, in the unit of that day's coin.
// Null when the day's coin or its reference is not known. This is what the telemetry maths takes as rateAt.
export function smartRateAt(c, sm, hourMs, now) {
  const coin = coinOfDay(sm, utcDay(hourMs), utcDay(now));
  return coin ? contractedRate(c, sm.refs?.[coin]) : null;
}

// What the miner runs on today: machineOn for today's coin, or null.
export function smartMachineNow(c, sm, now) {
  const coin = coinOfDay(sm, utcDay(now), utcDay(now));
  return coin ? machineOn(c, coin, sm.refs?.[coin], sm.units?.[coin], sm.halls) : null;
}

// What a Smart Mining miner counts for in a fleet uptime: its reference daily payout as TH/s of ASIC power (its own unit
// changes with the coin, so it cannot be added to TH/s directly).
export const smartWeight = (c) => dailyUsd(c.budget, c.baseYield, 1) / GROSS_PER_TH_DAY;
