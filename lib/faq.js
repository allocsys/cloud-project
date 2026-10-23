// FAQ fallback: word-sensitive matcher, no LLM.
// matchFaq(question, ctx) -> { level: 'high' | 'medium' | 'none', id, answer, did, score }
// ctx is optional live data: { withdrawals: [{ id, status }], pick: reinvestPick(...) }.
// Approved by the owner on 21 Oct 2026 (the paused-day answer was added and approved the same day). Any change to an answer about payouts, fees, paused days or Smart Mining machines needs approving again
// (set FAQ_APPROVED back to false while it is reviewed).
import { MIN_WITHDRAW_USD, MIN_DEPOSIT_USD } from './data.js';
import { SWAP_FEE_PCT, REFUND_HOURS, serviceTiersText } from './rules.js';
import { SMART } from './smart.js';

export const FAQ_APPROVED = true;

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
  [/\bmin\b/g, 'minimum'],
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
  paused: 'pause', pausing: 'pause',
  help: 'support', contact: 'support', human: 'support', agent: 'support',
  safe: 'security', secure: 'security', hack: 'security', scam: 'security', legit: 'security', trust: 'security', protect: 'security',
  earning: 'earn', profit: 'earn', income: 'earn', reward: 'earn', revenue: 'earn',
  miner: 'plan', contract: 'plan', package: 'plan',
  purchase: 'buy', order: 'buy',
  expire: 'duration', runtime: 'duration', validity: 'duration', valid: 'duration',
  forgot: 'forgot', forgotten: 'forgot', lost: 'forgot',
  passcode: 'password', pw: 'password',
  rate: 'return', roi: 'return', yield: 'return',
  lowest: 'minimum', minimal: 'minimum', smallest: 'minimum', least: 'minimum',
  delay: 'slow', delayed: 'slow', late: 'slow',
  reimburse: 'refund', fake: 'security', ponzi: 'security',
  ethereum: 'erc20', eth: 'erc20', tron: 'trc20', trx: 'trc20', bsc: 'bep20', bnb: 'bep20', toncoin: 'ton',
  profitable: 'return', invest: 'return', investment: 'return',
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
    kw: { deposit: 4, add: 1, balance: 1, address: 1, btc: 1, usdt: 1, crypto: 1 }, phrases: ['add money', 'add deposit'], neg: ['withdraw', 'confirm', 'pending', 'minimum'],
    a: () => 'Open Wallet, choose Deposit, pick a network and send to the address shown. A deposit counts once the network has confirmed it.' },
  { id: 'deposit_confirm', q: 'My deposit is not showing', 
    kw: { confirm: 3, deposit: 2, pending: 2, arrive: 2, wait: 1, stuck: 3, missing: 3, showing: 2 }, phrases: ['not showing', 'still pending'], neg: ['email', 'verify'],
    a: () => 'Deposits only count after the network confirms them, which can take a while when the network is busy. If it is still missing after a few hours, contact support with the transaction ID.' },
  { id: 'withdraw_how', q: 'How do I withdraw?',
    kw: { withdraw: 4, request: 1, wallet: 1, address: 1, minimum: 2, money: 1 }, phrases: ['how withdraw'], neg: [],
    a: () => 'Open Wallet, choose Withdraw, enter the amount and your address, then submit. Our team reviews each request before it is paid.' },
  { id: 'withdraw_time', q: 'How long does a withdrawal take?',
    kw: { withdraw: 2, long: 2, time: 2, review: 3, pending: 2, status: 2, approve: 2, slow: 2, take: 1, where: 1 }, phrases: ['long withdraw', 'withdraw take', 'where withdraw', 'withdraw slow', 'slow withdraw'], neg: [],
    a: (c) => {
      const w = c && c.withdrawals && c.withdrawals[0];
      const base = 'Withdrawals are reviewed by our team and paid within 24 hours.';
      return w ? `${base} Your latest request (#${w.id}) is ${w.status}.` : `${base} You can follow the status in Wallet.`;
    } },
  { id: 'withdraw_min', q: 'What is the minimum withdrawal?',
    kw: { minimum: 4, withdraw: 2, least: 2, limit: 3, small: 1 }, phrases: ['minimum withdraw'], neg: ['deposit'],
    a: () => `The minimum withdrawal is $${MIN_WITHDRAW_USD} worth of coin. We do not recommend withdrawing so little, because the network and swap fees take a large share of a small amount.` },
  { id: 'low_min', q: 'Can I withdraw small amounts?',
    kw: { small: 3, low: 3, little: 3, tiny: 3, withdraw: 1, amount: 1, start: 1, only: 1 }, phrases: ['small withdraw', 'low withdraw', 'withdraw small', 'withdraw little'], neg: ['deposit'],
    a: () => `Yes. You can withdraw from just $${MIN_WITHDRAW_USD}, much lower than many cloud mining platforms. The network fee is flat, so it takes a bigger share of a small withdrawal. The fees and what you receive are shown before you confirm.` },
  { id: 'deposit_min', q: 'What is the minimum deposit?',
    kw: { minimum: 3, deposit: 2, least: 2, smallest: 2, limit: 2 }, phrases: ['minimum deposit'], neg: ['withdraw'],
    a: () => `The minimum deposit is $${MIN_DEPOSIT_USD}, or the equivalent in the coin you send.` },
  { id: 'plans', q: 'What are the plans?',
    kw: { plan: 3, hash: 2, buy: 2, choose: 1, differ: 1, which: 1, start: 1, price: 1 }, phrases: ['which plan', 'hash power'], neg: ['duration', 'reinvest'],
    a: () => 'There are no fixed plans. In Plans you choose ASICs power (you pick the hash power and the term) or Smart Mining (you pick a budget and a term). The ASICs power price follows the live market and is locked at the moment you buy, so a later change does not affect it. The price, run time and details are shown before you buy.' },
  { id: 'plan_duration', q: 'How long does a plan run?',
    kw: { duration: 4, plan: 1, end: 2, last: 2, renew: 3, long: 1, run: 2, day: 3, month: 3, year: 3 }, phrases: ['plan end', 'plan last', 'plan run', 'many day', 'day plan'], neg: ['withdraw'],
    a: () => 'The run time is shown on each plan in Plans. Check it before you buy.' },
  { id: 'earnings_how', q: 'How are earnings calculated?',
    kw: { earn: 3, calculate: 3, daily: 2, much: 1, day: 1, hash: 1, per: 1 }, phrases: ['how much earn', 'per day'], neg: ['change', 'drop', 'guarantee'],
    a: () => 'Each day your hash power mines bitcoin at that day\u2019s network difficulty and bitcoin price. Electricity and maintenance come out of that, and the rest is your payout, paid in BTC at 00:00 UTC. A paid day is never changed afterwards. Amounts vary and are not guaranteed.' },
  { id: 'earnings_change', q: 'Why did my earnings change?',
    kw: { earn: 1, change: 3, drop: 3, lower: 2, less: 2, down: 2, differ: 1, why: 1, fluctuate: 3 }, phrases: ['earn change', 'earn drop'], neg: [],
    a: () => 'Each day is worked out from that day\u2019s bitcoin price and network difficulty, so your daily amount moves with the market. A falling price or rising difficulty means a lower payout, and on a day when costs are above what the machines mine the payout is zero, and the hall may be paused for that day. Check Earnings for your recent days; if a figure looks wrong, contact support.' },
  { id: 'paused_day', q: 'Why was my miner paused for a day?',
    kw: { pause: 10, guard: 4 }, phrases: ['paused day', 'miner paused', 'profit guard', 'plan pause'], neg: [],
    a: () => 'To avoid mining at a loss, we switch a hall (or Smart Mining) off for a whole day when that day would not have been profitable. That day pays nothing. Depending on the setting when you bought your plan, a paused day is either added to the end of your term or counts as one of its days. It is decided once the day is over, so a paid day never changes. Your miner page lists paused days and shows the end date of your term, and paused days do not count against uptime. The Terms page has the details.' },
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
    kw: { fee: 4, hidden: 2, extra: 1, network: 1, swap: 3, spread: 2 }, phrases: [], neg: [],
    a: () => 'A plan costs only the price shown as Total due. Electricity and maintenance are not billed to you: they come out of your mining, so the daily figure is already after them. Bitcoin has no swap fee; other coins pay a ' + SWAP_FEE_PCT + '% swap fee, and withdrawals also pay a flat network fee. Withdrawals may also pay a small service fee that drops to zero the longer you wait; see \u2018Is there a fee for withdrawing?\u2019. Every fee is shown before you confirm, and the Terms page lists them all.' },
  { id: 'withdraw_fee', q: 'Is there a fee for withdrawing?',
    kw: { fee: 3, service: 4, withdraw: 1, wait: 1 }, phrases: ['withdraw fee', 'service fee', 'fee withdraw'], neg: ['deposit'],
    a: () => 'Every withdrawal pays the network fee for the network you choose, plus ' + SWAP_FEE_PCT + '% if you\u2019re paid in a coin other than BTC. There is also a small service fee that depends on how long it has been since your last withdrawal: ' + serviceTiersText() + '. If you haven\u2019t withdrawn yet, we count from your first purchase. The wallet shows the exact fee before you confirm. Reinvesting your earnings is always free.' },
  { id: 'support', q: 'How do I contact support?',
    kw: { support: 4, email: 1, talk: 2, speak: 2, person: 2, problem: 2, issue: 2, ticket: 2 }, phrases: ['talk person'], neg: [],
    a: () => 'Contact support from the Help section in the app. For payment or account problems a person will look at it.' },
  { id: 'password', q: 'I forgot my password',
    kw: { password: 4, forgot: 3, reset: 3, login: 2, locked: 2, account: 1, access: 1 }, phrases: ['forgot password', 'reset password', 'change password'], neg: [],
    a: () => 'Use the reset option on the login screen. If you cannot get in, contact support.' },
  { id: 'networks', q: 'Which coins and networks are supported?',
    kw: { network: 3, btc: 2, usdt: 2, trc20: 3, erc20: 3, bep20: 3, ton: 3, coin: 2, crypto: 2, currency: 2, accept: 2, support: 1 }, phrases: ['support erc20', 'support trc20', 'support bep20', 'support ton'], neg: ['withdraw', 'fee'],
    a: () => 'The networks you can use are listed on the deposit screen in Wallet.' },
  { id: 'pay_method', q: 'Can I pay by card or bank?',
    kw: { card: 3, paypal: 3, bank: 3, usd: 2, visa: 3, pay: 1, method: 2, dollar: 2 }, phrases: [], neg: [],
    a: () => 'Plans are paid with crypto or from your balance.' },
  { id: 'btc_price', q: 'Do earnings depend on the bitcoin price and difficulty?',
    kw: { difficulty: 6, halving: 6, volatile: 4, volatility: 4, price: 2, btc: 1, market: 3, crash: 3 }, phrases: ['btc price'], neg: ['deposit', 'withdraw'],
    a: () => 'Yes. Your payout for each day follows that day\u2019s bitcoin price and the network\u2019s mining difficulty, so it goes up and down. When difficulty rises or the price falls, the same hash power earns less, and you can receive less than the plan cost over its term. The figure on a plan screen is an estimate at today\u2019s market, not a promise.' },
  { id: 'multi_plan', q: 'Can I buy more than one plan?',
    kw: { multiple: 5, several: 4, another: 4, second: 3, many: 3, plan: 1 }, phrases: ['another plan', 'second plan', 'more plan', 'many plan', 'buy more'], neg: [],
    a: () => 'Yes. Each plan you buy is its own miner with its own Miner ID.' },
  { id: 'wrong_address', q: 'I used the wrong network or address',
    kw: { wrong: 5, mistake: 4, incorrect: 4, typo: 3, recover: 3, address: 2, network: 1 }, phrases: ['wrong network', 'wrong address', 'wrong coin'], neg: [],
    a: () => 'Crypto transfers cannot be reversed. If you used the wrong network or address, contact support right away with the transaction ID. We cannot promise the funds can be recovered, so always check the network and address before you send.' },
  { id: 'register', q: 'How do I create an account?',
    kw: { register: 6, create: 3, account: 1, join: 3, email: 1, start: 1 }, phrases: ['create account'], neg: ['close', 'delete'],
    a: () => 'On the sign-in screen choose Create account, enter your email and a password, or continue with Telegram. You can also explore the demo first.' },
  { id: 'close_account', q: 'How do I close my account?',
    kw: { close: 5, delete: 5, deactivate: 5, remove: 2, account: 1 }, phrases: ['close account', 'delete account'], neg: [],
    a: () => 'Open Settings and choose Close account. You need your password and a code, and you type DELETE to confirm. Before you confirm, the screen shows what is kept, what is lost, and what happens to your balance and any running miners. The Terms and Privacy Policy cover the details.' },
  { id: 'twofa', q: 'How do I turn on 2FA?',
    kw: { '2fa': 6, authenticator: 4, factor: 2, enable: 2, turn: 1, switch: 1 }, phrases: [], neg: [],
    a: () => 'Open Settings and use the 2FA switch to turn two-factor sign-in on or off. It adds a code step when you sign in, which makes your account safer.' },
  { id: 'demo', q: 'What is the demo?',
    kw: { demo: 6, try: 2, test: 2, explore: 3, free: 2, practice: 2 }, phrases: [], neg: [],
    a: () => 'The demo lets you explore the app and the plan sheet with nothing charged. Start it from the sign-in screen with Explore the demo first, and create a real account whenever you like.' },
  { id: 'invite', q: 'How do invite codes work?',
    kw: { invite: 5, referral: 5, refer: 5, friend: 3, rebate: 4, bonus: 3, promo: 3, code: 1 }, phrases: [], neg: [],
    a: () => 'An invite code is applied when you create your account, and the sign-up screen shows the rebate it gives. Open the invite link you were sent so the code is filled in for you.' },
  { id: 'miner_id', q: 'What is a Miner ID?',
    kw: { id: 3, serial: 4 }, phrases: ['miner id'], neg: [],
    a: () => 'Every plan you buy gets its own Miner ID, like OP-0004389. You see it before you pay and on that miner\u2019s page.' },
  { id: 'electricity', q: 'Who pays for electricity and maintenance?',
    kw: { electricity: 6, maintenance: 6, kwh: 4, energy: 3, power: 2 }, phrases: [], neg: [],
    a: () => 'Electricity and maintenance are not billed to you. They come out of your mining, so the daily figure shown on a plan is already after them. Total due is the only charge for the plan.' },
  { id: 'hardware', q: 'Do I need hardware? Where are the machines?',
    kw: { hardware: 5, machine: 4, rig: 4, own: 3, physical: 3, hall: 5, location: 2, texas: 3, abilene: 3, rent: 2, asic: 4, antminer: 4 }, phrases: [], neg: [],
    a: () => 'No hardware needed: you rent hash power and the machines run in our halls. The plan sheet shows the hall (location and power rate) and the rig for your plan before you pay. Smart Mining has no hall of its own: each day your budget runs on the halls of the coin it is on (ASIC machines for BTC, GPU for KAS and RVN, CPU for XMR), and your miner page shows today\u2019s hall and rig.' },
  { id: 'smart_mining', q: 'What is Smart Mining?',
    kw: { smart: 6, budget: 4, pick: 2, switch: 2, best: 2, auto: 2 }, phrases: ['smart mining'], neg: ['reserve', 'seed', 'smooth'],
    a: () => 'Smart Mining lets you choose a budget and a term, and each day we mine the coin that looks most profitable that day. Payouts are still in BTC. The figure shown is an estimate at today\u2019s market, not a promise, and the real result moves with prices and difficulty, so you can receive less than the plan cost. Your miner page shows the coin of the day, the hall and rig it runs on, and the hashrate your budget is contracted for in that coin\u2019s unit, with the uptime of that hashrate. It is only shown in Plans while it is switched on.' },
  { id: 'smart_reserve', q: 'How does the Smart Mining reserve work?',
    kw: { reserve: 8, smooth: 6, seed: 5, leftover: 4, band: 3, smart: 1 }, phrases: ['smart reserve', 'mining reserve'], neg: [],
    a: () => 'Smart Mining evens out your daily payout. Profit above the top of a set range goes into a reserve, and a weak day is topped up from the reserve, only as far as it holds. The reserve starts with ' + +(SMART.seed * 100).toFixed(2) + '% of your budget put in by us. At the end of the term that amount goes back to us and anything above it is split equally between you and us. It evens out payouts but does not guarantee any payout or protect your budget. The Terms page has the details.' },
  { id: 'refund', q: 'Can I get a refund?',
    kw: { refund: 6, chargeback: 4, cancel: 3, reverse: 3, back: 2, undo: 2 }, phrases: ['money back', 'cancel plan'], neg: [],
    a: () => 'A plan can be refunded within ' + REFUND_HOURS + ' hours of buying it, as long as it has not paid out yet. Its first payout day ends at 00:00 UTC, so ask before then. After that it cannot be refunded. Contact support with your Miner ID.' },
  { id: 'units', q: 'What do sats and TH/s mean?',
    kw: { sat: 6, satoshi: 6, unit: 3, mean: 2, hash: 2 }, phrases: [], neg: [],
    a: () => 'A sat is the smallest bitcoin unit: 100,000,000 sats make 1 BTC. TH/s is terahashes per second, the measure of the hash power your plan gives you.' },
  { id: 'notifications', q: 'Where are my notifications?',
    kw: { notification: 5, notify: 5, alert: 4, bell: 4 }, phrases: [], neg: [],
    a: () => 'Tap the bell on the Earnings screen to see your notifications.' },
  { id: 'earn_timing', q: 'When is the next payout?',
    kw: { next: 3, countdown: 4, credit: 3, arrive: 2, earn: 2, when: 2 }, phrases: ['next withdraw'], neg: [],
    a: () => 'Earnings are credited daily. The Earnings screen shows a countdown to your next payout.' },
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
