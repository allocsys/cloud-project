// Boost tickets: maths and rules. Pure (no storage), so the server, the admin screen and the buy sheet work out the same numbers.
// A ticket starts a boost: simulated hashrate for BOOST.hours hours that pays at the flat BOOST.rate, plus a prize draw.
// Each purchase is its own boost with its own draw. The draw is made on the server at purchase and only shown once the boost ends.
// The admin sets the chance (in percent) for each ticket; the margin is never typed, it follows from the chance (marginOf).
// Everything a boost needs is fixed on it at purchase (u.boosts[]), so a later change of the settings never touches a running one:
//   { id, t (ticket), price, th, pay, prize, chance (percent), win, rate (BTC price at purchase), startAt, endsAt, settled }
// Both the boost pay and the prize reach the balance once the boost has ended (boostUsdOf), in BTC at the purchase-time rate, the
// same rate the ticket was charged at, so the BTC price moving in between changes nothing.

export const BOOST = { hours: 2, rate: 0.021, defaultChance: 5, maxChance: 100 };

const r2 = (v) => Math.round(v * 100) / 100;

// USD a boost of `th` TH/s pays over its hours: th x rate per day x hours / 24.
export const boostPay = (th) => r2((th * BOOST.rate * BOOST.hours) / 24);

export const TICKETS = [
  { id: 't1', price: 1, th: 120, prize: 10, max: 10 },
  { id: 't10', price: 10, th: 1200, prize: 100, max: 10 },
  { id: 't100', price: 100, th: 12000, prize: 1000, max: 5 },
].map((t) => ({ ...t, pay: boostPay(t.th) }));

export const ticketOf = (id) => TICKETS.find((t) => t.id === id) || null;

export const BOOST_DEFAULTS = { enabled: false, chance: Object.fromEntries(TICKETS.map((t) => [t.id, BOOST.defaultChance])) };

// Saved settings (or nothing) as a full, valid set. Anything missing or out of range falls back to the default.
export function normalizeBoost(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const ch = r.chance && typeof r.chance === 'object' ? r.chance : {};
  const chance = {};
  for (const t of TICKETS) {
    const v = ch[t.id];
    const x = Number(v);
    chance[t.id] = v !== null && v !== undefined && v !== '' && Number.isFinite(x) && x >= 0 && x <= BOOST.maxChance ? r2(x) : BOOST.defaultChance;
  }
  return { enabled: r.enabled === true, chance };
}

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
