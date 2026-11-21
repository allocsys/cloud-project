// Placeholder data for the loading state (class "ld" in app/globals.css).
// While the first answer from the server is on its way, a screen draws itself with this data, so the loading screen has exactly
// the layout of the real one. Text, icons and fields are then shown as soft blocks and nothing can be tapped.
// Only the shapes matter (how many rows, how long a text is); nothing here is ever shown as a figure, and it is never saved or sent.

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const day = (i) => `${i + 1} Jan`;

const MINER = {
  serial: 'VTX-000000',
  name: 'Smart Mining',
  plan: 'Smart',
  hall: 'smart',
  smart: true,
  coin: 'KAS',
  th: 0,
  budget: 100,
  online: true,
  paused: false,
  dailyUsd: 1.5,
  elapsed: 10,
  days: 90,
  started: '1 Oct 2026',
  ends: '1 Jan 2027',
  extendedDays: 0,
  renew: false,
  renewable: true,
  firstBonus: null,
};

const HISTORY = [
  { kind: 'payout', label: 'Daily payout', date: '1 Jan', amount: '+0.00001234', coin: 'BTC', net: 'BTC', status: '', fee: '', at: 0 },
  { kind: 'payout', label: 'Daily payout', date: '1 Jan', amount: '+0.00001234', coin: 'BTC', net: 'BTC', status: '', fee: '', at: 0 },
  { kind: 'payout', label: 'Daily payout', date: '1 Jan', amount: '+0.00001234', coin: 'BTC', net: 'BTC', status: '', fee: '', at: 0 },
];

// The per-user bundle of the Earnings screen (/api/dashboard/bundle).
export const PH_BUNDLE = {
  miners: { contracts: [MINER] },
  dashboard: {
    hasMiners: true,
    totalTh: 100,
    todayBtc: 0.0001,
    totalBtc: 0.001,
    uptime: 99.9,
    avgUsd: 1.5,
    smartBudget: 0,
    asOf: null,
    earnings: { week: DAYS.map((label) => ({ label, usd: 1.5 })), all: [] },
    stats: { hash: [], uptime: [] },
  },
  referrals: { friends: [], earnedBtc: '0.00000', reward: '10%' },
  wallet: { earned: 0.001, withdrawn: 0, spent: 0, mined: 0.001, asOf: null, history: HISTORY.slice(0, 1) },
  notifications: { unread: 0 },
};

// One miner page (/api/miners/:serial): the earnings days, the uptime days, the coin history and the machine.
export const PH_MINER = MINER;
export const PH_MINER_DET = {
  contract: {
    earnedUsd: 100,
    earnedBtc: 0.001,
    daily: Array.from({ length: 14 }, (_, i) => ({ day: day(i), usd: 1.5, paused: false })),
    charts: {
      hash: { hasData: true, now: 100, series: Array.from({ length: 12 }, (_, i) => 90 + (i % 4) * 5) },
      uptime: { pct: 99.9, series: Array.from({ length: 14 }, (_, i) => ({ day: day(i), pct: 100 })) },
    },
    coins: { today: 'KAS', history: Array.from({ length: 13 }, (_, i) => ({ day: day(i), coin: 'KAS' })) },
    machine: { coin: 'KAS', unit: 'TH/s', rate: 100, kwh: 0, hall: { name: 'Hall', place: 'Place', rig: 'Rig', power: '1 MW' } },
  },
};

// My miners on the Plans screen.
export const PH_MINERS = [MINER, { ...MINER, serial: 'VTX-000001' }];

// The account on the Settings screen (/api/auth/me): an email account with every row.
export const PH_ME = { email: 'name@example.com', verified: true, mail: true, twofa: false, botLinked: false, demo: false, telegram: false, name: '' };

// The Invite screen (/api/referrals) and its VIP card.
export const PH_REF = {
  earnedBtc: '0.00000000',
  friends: [],
  code: 'XXXXXXXX',
  codes: [{ code: 'XXXXXXXX', name: 'Default', rebate: 0, default: true, friends: 0, earnedBtc: '0' }],
  reward: '10% of payouts',
  gift: '',
};
export const PH_VIP = {
  level: 1,
  now: { first: 5, daily: 1, cap: 100, tickets: 0 },
  next: { level: 2, first: 6, daily: 2, leftUsd: 100, leftFriends: null, minSpendUsd: 200, minFriends: null },
  keeps: null,
  hold: null,
};

// Boost tickets on the Plans screen (/api/boost).
export const PH_BOOST = {
  enabled: true,
  hours: 2,
  free: 0,
  now: 0,
  running: [],
  finished: [],
  tickets: [1, 2, 3].map((i) => ({ id: `t${i}`, price: 10 * i, th: 10 * i, pay: 1.5, chance: 10, prize: 100, active: 0, max: 3 })),
};

// Wallet history rows.
export const PH_HISTORY = HISTORY;
