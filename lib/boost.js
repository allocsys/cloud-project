// Boost tickets: maths and rules. Pure (no storage), so the server, the admin screen and the buy sheet work out the same numbers.
// A ticket starts a boost: simulated hashrate for BOOST.hours hours that pays at the flat BOOST.rate, plus a prize draw.
// Each purchase is its own boost with its own draw. The draw is made on the server at purchase and only shown once the boost ends.
// The admin sets two chances (in percent) for each ticket: the real one (used for the draw and the margin) and the shown one (what users
// see; empty = the same as the real one, see shownOf). The margin is never typed, it follows from the real chance (marginOf).
// Everything a boost needs is fixed on it at purchase (u.boosts[]), so a later change of the settings never touches a running one:
//   { id, t (ticket), price, th, pay, prize, chance (real, percent), shown (percent users see), win, rate (BTC price at purchase), startAt, endsAt, settled }
// Both the boost pay and the prize reach the balance once the boost has ended (boostUsdOf), in BTC at the purchase-time rate, the
// same rate the ticket was charged at, so the BTC price moving in between changes nothing.

export const BOOST = { hours: 2, rate: 0.021, defaultChance: 5, maxChance: 100 };

const r2 = (v) => Math.round(v * 100) / 100;

// USD a boost of `th` TH/s pays over its hours: th x rate per day x hours / 24.
export const boostPay = (th) => r2((th * BOOST.rate * BOOST.hours) / 24);

// `coin` is the coin the ticket's hashrate mines; the pay itself still reaches the balance in BTC.
export const TICKETS = [
  { id: 't1', price: 1, th: 120, prize: 10, max: 10, coin: 'LTC' },
  { id: 't10', price: 10, th: 1200, prize: 100, max: 10, coin: 'LTC' },
  { id: 't100', price: 100, th: 12000, prize: 1000, max: 5, coin: 'ETC' },
].map((t) => ({ ...t, pay: boostPay(t.th) }));

export const ticketOf = (id) => TICKETS.find((t) => t.id === id) || null;

export const BOOST_DEFAULTS = {
  enabled: false,
  chance: Object.fromEntries(TICKETS.map((t) => [t.id, BOOST.defaultChance])),
  shown: Object.fromEntries(TICKETS.map((t) => [t.id, null])), // null = show the real chance
};

// Saved settings (or nothing) as a full, valid set. Anything missing or out of range falls back to the default.
export function normalizeBoost(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const ch = r.chance && typeof r.chance === 'object' ? r.chance : {};
  const sh = r.shown && typeof r.shown === 'object' ? r.shown : {};
  const chance = {};
  const shown = {};
  for (const t of TICKETS) {
    const v = ch[t.id];
    const x = Number(v);
    chance[t.id] = v !== null && v !== undefined && v !== '' && Number.isFinite(x) && x >= 0 && x <= BOOST.maxChance ? r2(x) : BOOST.defaultChance;
    const s = sh[t.id];
    const y = Number(s);
    shown[t.id] = s !== null && s !== undefined && s !== '' && Number.isFinite(y) && y >= 0 && y <= BOOST.maxChance ? r2(y) : null;
  }
  return { enabled: r.enabled === true, chance, shown };
}

// The chance users are told for a ticket: the shown one when the admin set it, else the real one.
export const shownOf = (cfg, ticketId) => cfg?.shown?.[ticketId] ?? cfg?.chance?.[ticketId];

export const boostOn = (cfg) => !!cfg?.enabled;

// What the platform keeps of each dollar sold, at a given chance (percent): 1 - (boost pay + chance x prize) / price. Negative means a loss.
export const marginOf = (t, chance) => 1 - (t.pay + (chance / 100) * t.prize) / t.price;

// Boosts of one ticket still running.
export const activeCount = (u, ticketId, now = Date.now()) => (u?.boosts || []).filter((b) => b.t === ticketId && now < b.endsAt).length;

// The draw. `roll` is an integer from 0 up to (not including) 1,000,000; a chance in percent has two decimals at most.
export const drawWins = (chance, roll) => roll < Math.round(chance * 10000);

// What one finished boost brings, in USD: the boost pay always, the prize when the draw was won.
export const boostResultUsd = (b) => r2(b.pay + (b.win ? b.prize : 0));

// Everything finished boosts have brought an account so far, in BTC (counted from the moment each one ends). It joins the balance in
// lib/server/wallet.js.
export function boostBtcOf(u, now = Date.now()) {
  let btc = 0;
  for (const b of u?.boosts || []) if (now >= b.endsAt && b.rate > 0) btc += boostResultUsd(b) / b.rate;
  return btc;
}

// ---- Winners bar (landing page, components/WinnersBar.js) ----
// A rolling bar of the latest prize wins: { name (masked), prize, at }. Real wins come first; sample ones only fill what is missing up to
// WINNERS.count, so as real wins come in they take over. Never a full id or email: maskId shows half of the part before the @.
export const WINNERS = { count: 12, maxAgoMin: 180 };

const SAMPLE_NAMES = ['alex', 'maria', 'john88', 'sara', 'omid_k', 'nima', 'dmitri', 'lena', 'carlos', 'aisha', 'tom', 'kaveh', 'yuki', 'pavel', 'nora', 'ali', 'mina92', 'ivan', 'zoe', 'reza', 'david', 'sofia', 'arman', 'leo_m'];

// Half of the name (at most 6 characters, at least 1), then four dots. The domain is never shown.
export function maskId(id) {
  const chars = [...String(id ?? '').split('@')[0]];
  const keep = Math.min(6, Math.max(1, Math.floor(chars.length / 2)));
  return `${chars.slice(0, keep).join('')}\u2022\u2022\u2022\u2022`;
}

const shuffle = (list, rand = Math.random) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// Sample wins for staging: mostly $10, some $100, now and then $1,000, each 1 to WINNERS.maxAgoMin minutes old.
export function mockWinners(now = Date.now(), rand = Math.random, n = WINNERS.count) {
  const names = shuffle(SAMPLE_NAMES, rand);
  return Array.from({ length: n }, (_, i) => {
    const roll = rand();
    return {
      name: maskId(names[i % names.length]),
      prize: roll < 0.7 ? 10 : roll < 0.95 ? 100 : 1000,
      at: now - 60_000 - Math.floor(rand() * WINNERS.maxAgoMin * 60_000),
    };
  });
}

// Real wins (newest first) take their places, sample ones fill the rest up to `count`, then everything is shown in random order.
export function pickWinners({ real = [], mock = [], count = WINNERS.count, rand = Math.random } = {}) {
  const top = real.slice(0, count);
  const taken = new Set(top.map((w) => w.name));
  const fill = mock.filter((w) => !taken.has(w.name)).slice(0, Math.max(0, count - top.length));
  return shuffle([...top, ...fill], rand);
}
