// First-buy bonus maths. Pure (no storage), so the server and the buy sheet work out the same numbers.
// A user's first paid buy (paid with crypto) can come with extra hashrate for the whole term. The admin sets:
//   enabled  the bonus is on
//   pct      percent of the purchase added on top
//   capTh    the most extra TH/s an ASICs buy can get
//   capUsd   the most extra budget (USD) a Smart Mining buy can get
//   minUsd   the smallest purchase that qualifies
//   until    the last moment (ms) the bonus is on, or null for no end
// ASICs: the miner gets extra TH/s, so everything that follows its TH/s (earnings, charts, invite rewards) follows it too.
// Smart Mining has no TH/s of its own: the extra is on the profit rate. The budget that comes back is not touched; the plan is
// priced at a payout raised by the bonus share (the cap is that share of the budget, in USD).
// The bonus is fixed on the miner at purchase (contract.firstBonus), so a later change of the settings never touches it.
import { smartPlan, SMART } from '@/lib/smart';

export const FIRST_BONUS = { enabled: false, pct: 10, capTh: 5, capUsd: 50, minUsd: 50, until: null };
export const FIRST_BONUS_MAX = { pct: 100, capTh: 1000, capUsd: 10000, minUsd: 100000 };

const r2 = (v) => Math.round(v * 100) / 100;
const r5 = (v) => Math.round(v * 1e5) / 1e5;

// Saved settings (or nothing) as a full, valid set. Anything missing or out of range falls back to the default.
export function normalizeFirstBonus(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const num = (v, def, min, max) => {
    const x = Number(v);
    return v !== null && v !== undefined && v !== '' && Number.isFinite(x) && x >= min && x <= max ? x : def;
  };
  return {
    enabled: r.enabled === true,
    pct: num(r.pct, FIRST_BONUS.pct, 0.1, FIRST_BONUS_MAX.pct),
    capTh: num(r.capTh, FIRST_BONUS.capTh, 0.01, FIRST_BONUS_MAX.capTh),
    capUsd: num(r.capUsd, FIRST_BONUS.capUsd, 0.01, FIRST_BONUS_MAX.capUsd),
    minUsd: num(r.minUsd, FIRST_BONUS.minUsd, 0, FIRST_BONUS_MAX.minUsd),
    until: Number.isFinite(r.until) && r.until > 0 ? r.until : null,
  };
}

export const firstBonusOn = (cfg, now = Date.now()) => !!cfg?.enabled && (!cfg.until || now < cfg.until);

// Whether this account has never paid for a miner. A paid buy (balance or crypto) sets u.firstBuy; older accounts are told by their
// miners and activity. Gift miners (contract.bonus) do not count, admin grants and the demo wipe follow from the same rules.
export function isFirstBuy(u) {
  if (!u || u.firstBuy) return false;
  if ((u.contracts || []).some((c) => !c.bonus && c.price > 0)) return false;
  return !(u.history || []).some((h) => h.kind === 'purchase' && (h.net === 'Balance' || h.net === 'Crypto'));
}

// The plan with the bonus laid on, and the bonus itself: { plan, bonus }, where bonus is { pct, th } for ASICs or { pct, usd } for
// Smart Mining. Null when the bonus is off, the purchase is below the minimum, or the bonus would be nothing. The price never changes.
export function applyFirstBonus(cfg, plan, now = Date.now()) {
  if (!firstBonusOn(cfg, now) || !plan || !(plan.price >= cfg.minUsd)) return null;
  if (plan.smart) {
    const base = r5((plan.baseYield * plan.days - 1) / plan.days); // the payout the plan was priced at
    if (!(base > 0) || !(plan.budget > 0)) return null;
    const extra = Math.min((plan.budget * cfg.pct) / 100, cfg.capUsd);
    const payout = Math.min(SMART.payoutMax, r5(base * (1 + extra / plan.budget)));
    if (!(payout > base)) return null;
    const share = payout / base - 1;
    return { plan: { ...plan, ...smartPlan(plan.budget, plan.days, payout) }, bonus: { pct: Math.round(share * 1000) / 10, usd: r2(plan.budget * share) } };
  }
  if (!(plan.th > 0)) return null;
  const th = Math.floor(Math.min((plan.th * cfg.pct) / 100, cfg.capTh) * 100 + 1e-9) / 100;
  if (!(th >= 0.01)) return null;
  const total = r2(plan.th + th);
  const daily = parseFloat(String(plan.daily).replace('$', ''));
  return {
    plan: { ...plan, th: total, ...(Number.isFinite(daily) ? { daily: `$${((daily * total) / plan.th).toFixed(2)}` } : {}) },
    bonus: { pct: Math.round((th / plan.th) * 1000) / 10, th },
  };
}

// The amount as the user reads it: "1.5 TH/s" for ASICs, "10%" for Smart Mining.
export const bonusText = (b) => (b?.th ? `${+b.th.toFixed(2)} TH/s` : `${b?.pct}%`);
