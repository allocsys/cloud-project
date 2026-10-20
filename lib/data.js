// Placeholder content. Replace with your API responses.
// Dates and "elapsed" values are fixed on purpose so the static pages render the same everywhere.

export const BTC_USD = 84800;

// Wallet balance = what the miners have earned + this credit + referral rewards - withdrawals.
// The credit is the sample $100 USDT deposit in the history below, after its 1% swap fee, at BTC_USD.
export const CREDIT_BTC = 0.00116745;
// The sample withdrawal in the history below. New accounts start with it already taken out.
export const SEED_WITHDRAWN = 0.0005;
export const MIN_WITHDRAW = 0.0005;
export const BLOCK_HEIGHT = 871402;

// How the miner numbers below were worked out (late Sep 2026, hashrateindex.com):
// hashprice about $39.8 per PH/s per day, i.e. $0.0398 gross per TH/s per day, network about 950 EH/s.
// `net` is what one TH/s earns per day after the hall's electricity and a $0.002 maintenance share:
//   net = 0.0398 - (J/TH x 24 / 1000 x $/kWh) - 0.002
// Contract prices are set so the estimated payout over the term is roughly 106% of the price.
// That is a thin margin on purpose: real cloud mining returns are single-digit percent at best,
// and payouts follow BTC price and network difficulty. They are estimates, never promises.
export const halls = {
  'tx-1': {
    name: 'Abilene Hall 1',
    place: 'Texas, US',
    power: 'Wind and grid, $0.04/kWh',
    efficiency: '17.5 J/TH',
    rig: 'Antminer S21',
    net: 0.0210,
  },
  'is-2': {
    name: 'Reykjavík Hall 2',
    place: 'Iceland',
    power: 'Geothermal and hydro, $0.05/kWh',
    efficiency: '15.0 J/TH',
    rig: 'Antminer S21 Pro',
    net: 0.0198,
  },
  'no-1': {
    name: 'Hamar Hall 1',
    place: 'Norway',
    power: 'Hydro, $0.04/kWh',
    efficiency: '12.0 J/TH',
    rig: 'Antminer S21 XP Hyd',
    net: 0.0263,
  },
};

export const plans = [
  {
    id: 'starter',
    name: 'Starter',
    th: 15,
    price: 27,
    days: 90,
    daily: '$0.32',
    hall: 'tx-1',
    blurb: 'The smallest way in: 15 TH/s for 90 days, enough to see how daily payouts work.',
  },
  {
    id: 'basic',
    name: 'Basic',
    th: 60,
    price: 215,
    days: 180,
    daily: '$1.26',
    hall: 'tx-1',
    blurb: '60 TH/s on a six-month term in our Texas hall.',
  },
  {
    id: 'growth',
    name: 'Growth',
    th: 100,
    price: 335,
    days: 180,
    daily: '$1.98',
    featured: true,
    hall: 'is-2',
    blurb: '100 TH/s on a six-month term in our Iceland hall.',
  },
  {
    id: 'plus',
    name: 'Plus',
    th: 250,
    price: 1699,
    days: 365,
    daily: '$4.95',
    hall: 'is-2',
    blurb: 'A full year on 250 TH/s, powered by geothermal and hydro.',
  },
  {
    id: 'pro',
    name: 'Pro',
    th: 500,
    price: 4499,
    days: 365,
    daily: '$13.15',
    hall: 'no-1',
    blurb: '500 TH/s for a year on liquid-cooled machines, our most efficient hall.',
  },
  {
    id: 'elite',
    name: 'Elite',
    th: 1000,
    price: 8999,
    days: 365,
    daily: '$26.30',
    hall: 'no-1',
    blurb: '1 PH/s for a year in our most efficient hall, for serious hash power.',
  },
];

// Custom power: any size from 1 to 1000 TH/s (0.5 steps) on a 90, 180 or 365 day term.
// Same pricing rule as the plans: price = net rate x TH x days / 1.06, in the hall that fits the size.
export const CUSTOM = { min: 1, max: 1000, terms: [90, 180, 365] };
export const hallFor = (th) => (th < 100 ? 'tx-1' : th < 500 ? 'is-2' : 'no-1');
export const fmtTh = (th) => (Number.isInteger(th) ? String(th) : th.toFixed(1));
export const fmtUsd = (n) => n.toLocaleString(undefined, Number.isInteger(n) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Slider position (0 to 1000) to TH/s on a log scale, snapped to a sensible step for its size.
export function thFromPos(pos) {
  const raw = CUSTOM.min * Math.pow(CUSTOM.max / CUSTOM.min, pos / 1000);
  const th =
    raw < 10 ? Math.round(raw * 2) / 2 : raw < 100 ? Math.round(raw) : raw < 500 ? Math.round(raw / 5) * 5 : Math.round(raw / 10) * 10;
  return Math.min(CUSTOM.max, Math.max(CUSTOM.min, th));
}

export function customPlan(th, days, hallMap = halls) {
  const hall = hallFor(th);
  const net = hallMap[hall].net;
  return {
    id: 'custom',
    name: 'Custom',
    th,
    days,
    hall,
    price: Math.round(((th * net * days) / 1.06) * 100) / 100,
    daily: `$${(th * net).toFixed(2)}`,
    blurb: 'Pick your own power and term.',
  };
}

export const contracts = [
  {
    serial: 'OP-0004217',
    online: true,
    name: 'Growth 100 TH/s',
    plan: 'Growth',
    th: 100,
    hall: 'is-2',
    started: '2 Oct',
    ends: '30 Mar 2027',
    days: 180,
    elapsed: 16,
    startDay: 2,
    dailyUsd: 1.98,
    status: 'active',
  },
  {
    serial: 'OP-0004388',
    online: true,
    name: 'Starter 15 TH/s',
    plan: 'Starter',
    th: 15,
    hall: 'tx-1',
    started: '14 Oct',
    ends: '12 Jan 2027',
    days: 90,
    elapsed: 4,
    startDay: 14,
    dailyUsd: 0.32,
    status: 'active',
  },
];

// Newest first. `amount` keeps its sign so the UI can colour it.
export const history = [
  { kind: 'payout', label: 'Daily payout', date: '17 Oct', amount: '+0.00003', coin: 'BTC', net: 'BTC' },
  { kind: 'payout', label: 'Daily payout', date: '16 Oct', amount: '+0.00003', coin: 'BTC', net: 'BTC' },
  { kind: 'payout', label: 'Daily payout', date: '15 Oct', amount: '+0.00003', coin: 'BTC', net: 'BTC' },
  { kind: 'purchase', label: 'Starter plan', date: '14 Oct', amount: '-$27' },
  { kind: 'payout', label: 'Daily payout', date: '13 Oct', amount: '+0.00003', coin: 'BTC', net: 'BTC' },
  { kind: 'withdrawal', label: 'Withdrawal · BTC', date: '12 Oct', amount: '-0.0005', coin: 'BTC', net: 'BTC', fee: '0.0001 BTC' },
  { kind: 'payout', label: 'Daily payout', date: '11 Oct', amount: '+0.00003', coin: 'BTC', net: 'BTC' },
  { kind: 'deposit', label: 'Deposit · USDT', date: '9 Oct', amount: '+100.00', coin: 'USDT', net: 'TRC20', fee: '1% swap' },
  { kind: 'purchase', label: 'Growth plan', date: '2 Oct', amount: '-$335' },
];

// Newest first. Placeholder. Replace with your API.
export const notifications = [
  { id: 'n1', kind: 'payout', title: 'Daily payout received', body: '+0.00003 BTC from your 2 miners', when: '2h ago' },
  { id: 'n2', kind: 'referral', title: 'A friend joined', body: 'a***@mail.com signed up with your code', when: 'Yesterday' },
  { id: 'n3', kind: 'payout', title: 'Daily payout received', body: '+0.00003 BTC from your 2 miners', when: '17 Oct' },
  { id: 'n4', kind: 'purchase', title: 'Starter miner is live', body: 'OP-0004388 started mining', when: '14 Oct' },
  { id: 'n5', kind: 'withdrawal', title: 'Withdrawal sent', body: '0.0005 BTC to your wallet', when: '12 Oct' },
  { id: 'n6', kind: 'news', title: 'Welcome to Miner Opus', body: 'Your first miner is live and earning.', when: '2 Oct' },
];

// Daily earnings in USD, matching the two miners above (about $1.98/day, then $2.30/day from 14 Oct).
// The last entry is today, still accruing.
export const earnings = {
  week: [
    { label: 'Mon', day: '12 Oct', usd: 1.97 },
    { label: 'Tue', day: '13 Oct', usd: 2.0 },
    { label: 'Wed', day: '14 Oct', usd: 1.98 },
    { label: 'Thu', day: '15 Oct', usd: 2.29 },
    { label: 'Fri', day: '16 Oct', usd: 2.32 },
    { label: 'Sat', day: '17 Oct', usd: 2.3 },
    { label: 'Today', day: '18 Oct', usd: 0.84, partial: true },
  ],
  all: [1.98, 1.96, 2.0, 1.98, 1.97, 1.99, 2.0, 1.97, 2.01, 1.98, 1.99, 1.98, 2.29, 2.32, 2.3, 0.84].map(
    (usd, i, a) => ({
      label: String(3 + i),
      day: `${3 + i} Oct`,
      usd,
      partial: i === a.length - 1,
    })
  ),
};

export const TODAY_BTC = 0.84 / BTC_USD;

// Shown only until /api/referrals answers. The real code, rules, friends and rewards come from lib/server/referrals.js.
export const referral = {
  code: '',
  ratePct: 3,
  reward: '3% + 1% daily',
  gift: '',
  rules: [],
  earnedBtc: '0',
  friends: [],
};

// Deterministic payouts for one contract, newest first. Replace with your API.
export function contractDaily(c) {
  return Array.from({ length: c.elapsed }, (_, i) => {
    const k = c.elapsed - 1 - i;
    const wobble = ((k * 7) % 5) - 2;
    return { day: `${c.startDay + k} Oct`, usd: +(c.dailyUsd * (1 + wobble * 0.012)).toFixed(2) };
  });
}

// Last 24 hours of hashrate for one miner (TH/s). Deterministic placeholder. Replace with your API.
export function minerHash(c) {
  const series = Array.from({ length: 24 }, (_, i) =>
    c.online ? +(c.th * (1 - ((i * 7 + c.th) % 5) * 0.004)).toFixed(1) : 0
  );
  return { series, now: series[series.length - 1] };
}

// Sparkline series for the dashboard stat tiles. Replace with your API.
export const stats = {
  hash: [112, 114, 115, 115, 113, 115, 115, 115],
  uptime: [100, 100, 99.6, 100, 99.9, 100, 99.8],
};

// Account placeholder. kyc is one of: none, pending, verified.
export const account = {
  email: 'you@example.com',
  kyc: 'none',
  twofa: false,
  alerts: { payouts: true, withdrawals: true, news: false },
};
