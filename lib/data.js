// Placeholder content. Replace with your API responses.
// Dates and "elapsed" values are fixed on purpose so the static pages render the same everywhere.

export const BTC_USD = 67400;
export const MIN_WITHDRAW = 0.0005;
export const BLOCK_HEIGHT = 871402;

export const halls = {
  'is-2': {
    name: 'Reykjavík Hall 2',
    place: 'Iceland',
    power: 'Geothermal and hydro',
    efficiency: '17.5 J/TH',
  },
  'tx-1': {
    name: 'Abilene Hall 1',
    place: 'Texas, US',
    power: 'Wind and grid',
    efficiency: '19.0 J/TH',
  },
};

export const plans = [
  {
    id: 'starter',
    name: 'Starter',
    th: 20,
    price: 199,
    days: 90,
    daily: '$1.90',
    hall: 'tx-1',
    blurb: 'A small first position, enough to see how daily payouts work.',
  },
  {
    id: 'growth',
    name: 'Growth',
    th: 100,
    price: 899,
    days: 180,
    daily: '$9.40',
    featured: true,
    hall: 'is-2',
    blurb: 'Meaningful output on a six-month term in our Iceland hall.',
  },
  {
    id: 'pro',
    name: 'Pro',
    th: 500,
    price: 3990,
    days: 365,
    daily: '$48.20',
    hall: 'is-2',
    blurb: 'A full year of heavy hash power with the best efficiency we run.',
  },
];

export const contracts = [
  {
    serial: 'OP-0004217',
    name: 'Growth 100 TH/s',
    plan: 'Growth',
    th: 100,
    hall: 'is-2',
    started: '2 Oct',
    ends: '30 Mar 2027',
    days: 180,
    elapsed: 16,
    startDay: 2,
    dailyUsd: 9.4,
    status: 'active',
  },
  {
    serial: 'OP-0004388',
    name: 'Starter 20 TH/s',
    plan: 'Starter',
    th: 20,
    hall: 'tx-1',
    started: '14 Oct',
    ends: '12 Jan 2027',
    days: 90,
    elapsed: 4,
    startDay: 14,
    dailyUsd: 1.9,
    status: 'active',
  },
];

// Newest first. `amount` keeps its sign so the UI can colour it.
export const history = [
  { kind: 'payout', label: 'Daily payout', date: '17 Oct', amount: '+0.00017' },
  { kind: 'payout', label: 'Daily payout', date: '16 Oct', amount: '+0.00017' },
  { kind: 'payout', label: 'Daily payout', date: '15 Oct', amount: '+0.00017' },
  { kind: 'purchase', label: 'Starter plan', date: '14 Oct', amount: '-$199' },
  { kind: 'payout', label: 'Daily payout', date: '13 Oct', amount: '+0.00014' },
  { kind: 'withdrawal', label: 'Withdrawal', date: '12 Oct', amount: '-0.0005' },
  { kind: 'payout', label: 'Daily payout', date: '11 Oct', amount: '+0.00014' },
  { kind: 'purchase', label: 'Growth plan', date: '2 Oct', amount: '-$899' },
];

// Daily earnings in USD. The last entry is today, still accruing.
export const earnings = {
  week: [
    { label: 'Mon', day: '12 Oct', usd: 9.3 },
    { label: 'Tue', day: '13 Oct', usd: 9.5 },
    { label: 'Wed', day: '14 Oct', usd: 9.4 },
    { label: 'Thu', day: '15 Oct', usd: 11.2 },
    { label: 'Fri', day: '16 Oct', usd: 11.5 },
    { label: 'Sat', day: '17 Oct', usd: 11.3 },
    { label: 'Today', day: '18 Oct', usd: 4.1, partial: true },
  ],
  all: [9.4, 9.3, 9.6, 9.5, 9.2, 9.4, 9.5, 9.3, 9.6, 9.3, 9.5, 9.4, 11.2, 11.5, 11.3, 4.1].map(
    (usd, i, a) => ({
      label: String(3 + i),
      day: `${3 + i} Oct`,
      usd,
      partial: i === a.length - 1,
    })
  ),
};

export const TODAY_BTC = 4.1 / BTC_USD;

// Referral programme placeholder. Replace with your API.
export const referral = {
  code: 'OPUS-7K2M',
  ratePct: 5,
  // Placeholder wording. Replace with your real terms.
  rules: [
    'Share your code or link. Your friend enters it when signing up.',
    'You earn 5% of your friend\'s daily payouts, paid in BTC on top of theirs.',
    'Friends show as pending until their first contract is active.',
    'Self-referrals and duplicate accounts are not rewarded.',
  ],
  earnedBtc: '0.00011',
  friends: [
    { id: 'r1', who: 'm***@gmail.com', joined: '12 Oct', status: 'active', earned: '+0.00007' },
    { id: 'r2', who: 'j***@proton.me', joined: '9 Oct', status: 'active', earned: '+0.00004' },
    { id: 'r3', who: 'a***@mail.com', joined: '16 Oct', status: 'pending', earned: '+0' },
  ],
};

// Deterministic payouts for one contract, newest first. Replace with your API.
export function contractDaily(c) {
  return Array.from({ length: c.elapsed }, (_, i) => {
    const k = c.elapsed - 1 - i;
    const wobble = ((k * 7) % 5) - 2;
    return { day: `${c.startDay + k} Oct`, usd: +(c.dailyUsd * (1 + wobble * 0.012)).toFixed(2) };
  });
}

// Sparkline series for the dashboard stat tiles. Replace with your API.
export const stats = {
  hash: [117, 119, 120, 120, 118, 120, 120, 120],
  uptime: [100, 100, 99.6, 100, 99.9, 100, 99.8],
};

// Account placeholder. kyc is one of: none, pending, verified.
export const account = {
  email: 'you@example.com',
  kyc: 'none',
  twofa: false,
  alerts: { payouts: true, withdrawals: true, news: false },
};
