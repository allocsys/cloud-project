// FAQ fallback: word-sensitive matcher, no LLM.
// matchFaq(question, ctx) -> { level: 'high' | 'medium' | 'none', id, answer, did, score }
// ctx is optional live data: { withdrawals: [{ id, status }], pick: reinvestPick(...) }.
// DRAFT: every answer must be approved by the owner/legal before launch (they describe payouts and fees).
export const FAQ_APPROVED = false;

const STOP = new Set('a an the is are am do does did i my me to of in on for and or it be can you we there this that with will would please'.split(' '));

const PHRASES = [
  [/cash ?outs?/g, 'withdraw'],
  [/pay ?outs?/g, 'withdraw'],
  [/top ?ups?/g, 'deposit'],
  [/two.?factor/g, '2fa'],
  [/log ?in/g, 'login'],
  [/sign ?in/g, 'login'],
  [/sign ?up/g, 'register'],
  [/hash ?rate/g, 'hash'],
  [/pay ?pal/g, 'paypal'],
];

// Synonyms, keyed by stemmed word.
const SYN = {
  withdrawal: 'withdraw', payout: 'withdraw', cashout: 'withdraw',
  fund: 'deposit', topup: 'deposit',
  bitcoin: 'btc', tether: 'usdt',
  th: 'hash', ths: 'hash', terahash: 'hash', hashpower: 'hash', hashrate: 'hash',
  compound: 'reinvest', rebuy: 'reinvest',
  verification: 'verify', verified: 'verify',
  charge: 'fee', cost: 'fee', commission: 'fee',
  tg: 'telegram',
  help: 'support', contact: 'support', human: 'support', agent: 'support',
  safe: 'security', secure: 'security', hack: 'security', scam: 'security', legit: 'security', trust: 'security', protect: 'security',
  earning: 'earn', profit: 'earn', income: 'earn', reward: 'earn', revenue: 'earn',
  miner: 'plan', contract: 'plan', package: 'plan',
  purchase: 'buy', order: 'buy',
  expire: 'duration', runtime: 'duration', validity: 'duration', valid: 'duration',
  forgot: 'forgot', forgotten: 'forgot', lost: 'forgot',
  passcode: 'password', pw: 'password',
  rate: 'return', roi: 'return', yield: 'return',
};

function stemOnce(w) {
  if (w.length > 4 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) return w.slice(0, -1);
  return w;
}
function canon(w) {
  const a = SYN[w];
  if (a) return a;
  let s = stemOnce(stemOnce(w));
  // "earnings" -> "earning" -> "earn"; try synonyms on each form
  return SYN[s] || SYN[stemOnce(w)] || s;
}

function edit(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

function words(text) {
  let t = String(text || '').toLowerCase();
  for (const [re, to] of PHRASES) t = t.replace(re, to);
  return t.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w));
}

// --- entries ---------------------------------------------------------------
// kw: canonical-ish words with weights (canonicalised below). phrases: adjacent-word bonus (+3). neg: words that rule an entry out (-4).
const RAW = [
  { id: 'deposit', q: 'How do I deposit?',
    kw: { deposit: 4, add: 1, balance: 1, address: 1, btc: 1, usdt: 1, crypto: 1 }, phrases: ['add money', 'add deposit'], neg: ['withdraw', 'confirm', 'pending'],
    a: () => 'Open Wallet, choose Deposit, pick a network and send to the address shown. A deposit counts once the network has confirmed it.' },
  { id: 'deposit_confirm', q: 'My deposit is not showing', 
    kw: { confirm: 3, deposit: 2, pending: 2, arrive: 2, wait: 1, stuck: 3, missing: 3, showing: 2 }, phrases: ['not showing', 'still pending'], neg: ['email', 'verify'],
    a: () => 'Deposits only count after the network confirms them, which can take a while when the network is busy. If it is still missing after a few hours, contact support with the transaction ID.' },
  { id: 'withdraw_how', q: 'How do I withdraw?',
    kw: { withdraw: 4, request: 1, wallet: 1, address: 1, minimum: 2, money: 1 }, phrases: ['how withdraw'], neg: [],
    a: () => 'Open Wallet, choose Withdraw, enter the amount and your address, then submit. Our team reviews each request before it is paid.' },
  { id: 'withdraw_time', q: 'How long does a withdrawal take?',
    kw: { withdraw: 2, long: 2, time: 2, review: 3, pending: 2, status: 2, approve: 2, slow: 2, take: 1, where: 1 }, phrases: ['long withdraw', 'withdraw take', 'where withdraw'], neg: [],
    a: (c) => {
      const w = c && c.withdrawals && c.withdrawals[0];
      const base = 'Withdrawals are reviewed by our team before payout, so they are not instant.';
      return w ? `${base} Your latest request (#${w.id}) is ${w.status}.` : `${base} You can follow the status in Wallet.`;
    } },
  { id: 'plans', q: 'What are the plans?',
    kw: { plan: 3, hash: 2, buy: 2, choose: 1, differ: 1, which: 1, start: 1, price: 1 }, phrases: ['which plan', 'hash power'], neg: ['duration', 'reinvest'],
    a: () => 'Each plan gives you a share of hash power for a set price. Open Plans to compare them and see the details before you buy.' },
  { id: 'plan_duration', q: 'How long does a plan run?',
    kw: { duration: 4, plan: 1, end: 2, last: 2, renew: 3, long: 1, run: 2 }, phrases: ['plan end', 'plan last', 'plan run'], neg: ['withdraw'],
    a: () => 'The run time is shown on each plan in Plans. Check it before you buy.' },
  { id: 'earnings_how', q: 'How are earnings calculated?',
    kw: { earn: 3, calculate: 3, daily: 2, much: 1, day: 1, hash: 1, per: 1 }, phrases: ['how much earn', 'per day'], neg: ['change', 'drop', 'guarantee'],
    a: () => 'Earnings accrue daily in line with your plan\u2019s hash power. Daily amounts vary and are not guaranteed.' },
  { id: 'earnings_change', q: 'Why did my earnings change?',
    kw: { earn: 1, change: 3, drop: 3, lower: 2, less: 2, down: 2, differ: 1, why: 1, fluctuate: 3 }, phrases: ['earn change', 'earn drop'], neg: [],
    a: () => 'Daily earnings can move up or down. Check Earnings for your recent days; if a figure looks wrong, contact support.' },
  { id: 'returns', q: 'Are returns guaranteed?',
    kw: { guarantee: 4, return: 3, risk: 3, loss: 3, lose: 3, double: 2, promise: 3, sure: 2, rich: 2 }, phrases: ['make money', 'lose money'], neg: [],
    a: () => 'No. Returns are not guaranteed and earnings vary. Cloud mining carries risk and you can lose money, so only use funds you can afford to lose.' },
  { id: 'reinvest', q: 'How do I reinvest?',
    kw: { reinvest: 6, again: 1, balance: 1, buy: 1, more: 1 }, phrases: ['from balance', 'pay balance'], neg: [],
    a: (c) => {
      const p = c && c.pick && c.pick.plan;
      return p
        ? `Your balance covers the ${p.name || p.id} plan. Open Plans and choose Pay from balance.`
        : 'Once your balance covers a plan, open Plans and choose Pay from balance.';
    } },
  { id: 'verify_email', q: 'I did not get my verification email',
    kw: { verify: 4, email: 3, code: 2, link: 2, spam: 2, receive: 1, resend: 3, get: 1 }, phrases: ['verify email'], neg: ['withdraw'],
    a: () => 'Check your spam folder first, then request a new link from the verification screen. If it still does not arrive, contact support.' },
  { id: 'telegram', q: 'Can I use it in Telegram?',
    kw: { telegram: 4, bot: 2, mini: 2, app: 2, install: 2, pwa: 3, android: 1, ios: 1, phone: 1 }, phrases: ['mini app'], neg: [],
    a: () => 'Yes. Miner Opus works as a Telegram Mini App and can also be installed to your home screen from the browser.' },
  { id: 'security', q: 'Is my account safe?',
    kw: { security: 4, '2fa': 3, password: 1, privacy: 2, data: 1 }, phrases: [], neg: ['forgot', 'reset'],
    a: () => 'Use a strong, unique password and never share it. We will never ask for your password or seed phrase. Report anything suspicious to support.' },
  { id: 'fees', q: 'Are there fees?',
    kw: { fee: 4, hidden: 2, extra: 1, network: 1 }, phrases: [], neg: [],
    a: () => 'A plan costs only the price shown as Total due. Electricity and maintenance are not billed to you: they come out of your mining, so the daily figure is already after them. Bitcoin has no swap fee; other coins pay a 1% swap fee, and withdrawals also pay a flat network fee. Every fee is shown before you confirm, and the Terms page lists them all.' },
  { id: 'support', q: 'How do I contact support?',
    kw: { support: 4, email: 1, talk: 2, speak: 2, person: 2, problem: 2, issue: 2, ticket: 2 }, phrases: ['talk person'], neg: [],
    a: () => 'Contact support from the Help section in the app. For payment or account problems a person will look at it.' },
  { id: 'password', q: 'I forgot my password',
    kw: { password: 4, forgot: 3, reset: 3, login: 2, locked: 2, account: 1, access: 1 }, phrases: ['forgot password', 'reset password'], neg: [],
    a: () => 'Use the reset option on the login screen. If you cannot get in, contact support.' },
  { id: 'networks', q: 'Which coins and networks are supported?',
    kw: { network: 3, btc: 2, usdt: 2, trc20: 3, erc20: 3, bep20: 3, ton: 3, coin: 2, crypto: 2, currency: 2, accept: 2, support: 1 }, phrases: [], neg: ['withdraw', 'fee'],
    a: () => 'The networks you can use are listed on the deposit screen in Wallet.' },
  { id: 'pay_method', q: 'Can I pay by card or bank?',
    kw: { card: 3, paypal: 3, bank: 3, usd: 2, visa: 3, pay: 1, method: 2, dollar: 2 }, phrases: [], neg: [],
    a: () => 'Plans are paid with crypto or from your balance.' },
];

const ENTRIES = RAW.map((e) => {
  const kw = {};
  for (const [k, v] of Object.entries(e.kw)) kw[canon(k)] = Math.max(kw[canon(k)] || 0, v);
  return {
    id: e.id, q: e.q, a: e.a, kw,
    phrases: e.phrases.map((p) => ' ' + words(p).map(canon).join(' ') + ' '),
    neg: e.neg.map(canon),
  };
});

const VOCAB = new Set();
for (const e of ENTRIES) {
  for (const k of Object.keys(e.kw)) VOCAB.add(k);
  for (const k of e.neg) VOCAB.add(k);
}

function fixTypo(w) {
  if (VOCAB.has(w) || w.length < 5) return w;
  const max = w.length >= 8 ? 2 : 1;
  let best = w, bd = max + 1;
  for (const v of VOCAB) {
    if (Math.abs(v.length - w.length) > max) continue;
    const d = edit(w, v);
    if (d < bd) { bd = d; best = v; }
  }
  return bd <= max ? best : w;
}

export function tokens(text) {
  return words(text).map(canon).map(fixTypo);
}

function score(e, toks, joined) {
  let s = 0;
  const seen = new Set(toks);
  for (const t of seen) if (e.kw[t]) s += e.kw[t];
  for (const p of e.phrases) if (p.trim() && joined.includes(p)) s += 3;
  for (const n of e.neg) if (seen.has(n)) s -= 4;
  return s;
}

export function matchFaq(question, ctx) {
  const toks = tokens(question);
  if (!toks.length) return { level: 'none', id: null, answer: null, did: null, score: 0 };
  const joined = ' ' + toks.join(' ') + ' ';
  const ranked = ENTRIES.map((e) => ({ e, s: score(e, toks, joined) })).sort((a, b) => b.s - a.s);
  const [top, second] = ranked;
  if (!top || top.s < 3) return { level: 'none', id: null, answer: null, did: null, score: top ? top.s : 0 };
  const high = top.s >= 6 && top.s >= 1.5 * Math.max(second.s, 0);
  const did = !high && second && second.s >= 3 && second.s >= 0.6 * top.s ? { id: second.e.id, q: second.e.q } : null;
  return { level: high ? 'high' : 'medium', id: top.e.id, answer: top.e.a(ctx || {}), did, score: top.s };
}

// Entries by id, for quick-question chips and "Did you mean" answers.
export function faqAnswer(id, ctx) {
  const e = ENTRIES.find((x) => x.id === id);
  return e ? e.a(ctx || {}) : null;
}
export function faqList() {
  return ENTRIES.map((e) => ({ id: e.id, q: e.q }));
}
