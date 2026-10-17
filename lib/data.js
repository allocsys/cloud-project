export const plans = [
  { id: 'starter', name: 'Starter', th: 20, price: 199, days: 90, daily: '$1.90' },
  { id: 'growth', name: 'Growth', th: 100, price: 899, days: 180, daily: '$9.40', featured: true },
  { id: 'pro', name: 'Pro', th: 500, price: 3990, days: 365, daily: '$48.20' },
];

export const contracts = [
  { name: 'Starter 20 TH/s', ends: '14 Jan 2027' },
  { name: 'Growth 100 TH/s', ends: '02 Apr 2027' },
];

export const history = [
  { label: 'Withdrawal', date: '12 Oct', amount: '-0.0020' },
  { label: 'Daily payout', date: '11 Oct', amount: '+0.00006' },
  { label: 'Plan purchase', date: '02 Oct', amount: '-$899' },
];

export const DEPOSIT_ADDRESS = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
export const MIN_WITHDRAW = 0.0005;
