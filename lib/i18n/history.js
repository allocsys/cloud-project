// Wallet history rows are built on the server in English (label, date, fee, net). These helpers show them in the
// chosen language: known labels are matched by shape and rebuilt from a key, anything unknown stays as it is.

// A plan name with a translated tier name shows it; any other name stays as it is.
function planName(n, t) {
  const k = `tier.${String(n).toLowerCase()}`;
  const v = t(k);
  return v === k ? n : v;
}

// [pattern, key, vars(match, t)]. Order matters: the generic "<name> plan" comes last.
const RULES = [
  [/^Daily payout$/, 'hist.payout', () => ({})],
  [/^Deposit$/, 'wal.deposit', () => ({})],
  [/^Withdrawal · (.+)$/, 'hist.wd', (m) => ({ sym: m[1] })],
  [/^Boost ticket · (.+)$/, 'hist.boost', (m) => ({ p: m[1] })],
  [/^Balance added by support$/, 'hist.adjAdd', () => ({})],
  [/^Balance deducted by support$/, 'hist.adjSub', () => ({})],
  [/^Refund · (.+)$/, 'hist.refund', (m, t) => {
    const base = m[1].replace(/ plan$/, '');
    const v = planName(base, t);
    return { plan: v === base ? m[1] : v };
  }],
  [/^Invite bonus · (.+)$/, 'hist.invBonus', (m) => ({ m: m[1] })],
  [/^Invite payouts · (.+)$/, 'hist.invPay', (m) => ({ m: m[1] })],
  [/^Invite rebate · (.+)$/, 'hist.invRebate', (m) => ({ pct: m[1] })],
  [/^Custom (.+) TH\/s$/, 'hist.custom', (m) => ({ th: m[1] })],
  [/^Smart Mining (.+)$/, 'hist.smart', (m) => ({ p: m[1] })],
  [/^(.+) plan$/, 'hist.plan', (m, t) => ({ name: planName(m[1], t) })],
];

export function histLabel(h, t) {
  const s = String(h.label ?? '');
  for (const [re, key, vars] of RULES) {
    const m = re.exec(s);
    if (m) return t(key, vars(m, t));
  }
  return s;
}

// "Just now" and short dates. Dates are rebuilt from the timestamp with the language's month names and Latin digits.
export function histDate(h, lang, t) {
  if (h.date === 'Just now') return t('hist.now');
  if (lang === 'en' || !h.at) return h.date;
  try {
    return new Intl.DateTimeFormat(`${lang}-u-ca-gregory-nu-latn`, { day: 'numeric', month: 'short' }).format(h.at);
  } catch {
    return h.date;
  }
}

// The fee text is "0.0001 BTC + $1.20 swap + $0.50 service": only the words swap and service change.
export function histFee(fee, t) {
  return String(fee)
    .replace(/ swap(?= \+|$)/, ` ${t('hist.swap')}`)
    .replace(/ service(?= \+|$)/, ` ${t('hist.service')}`);
}

const NETS = { Balance: 'hist.netBalance', Crypto: 'hist.netCrypto' };
export const histNet = (net, t) => (NETS[net] ? t(NETS[net]) : net);
