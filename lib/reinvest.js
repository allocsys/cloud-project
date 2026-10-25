import { CUSTOM, halls as HALLS, customPlan, thFromPos, fmtTh } from './data.js';

// Smart Reinvest: which catalogue plan the balance should buy.
// Best fit = the most expensive plan the balance covers, i.e. the most hash power for the money.
// Ties keep the larger hash power.
export function bestPlan(plans, balUsd) {
  const ok = (plans || []).filter((p) => p && p.price > 0 && p.price <= balUsd);
  if (!ok.length) return null;
  return ok.reduce((a, b) => (b.price > a.price || (b.price === a.price && b.th > a.th) ? b : a));
}

// The next plan up (cheapest one the balance does not cover yet), so a card can say how far away it is.
export function nextPlan(plans, balUsd) {
  const more = (plans || []).filter((p) => p && p.price > balUsd).sort((a, b) => a.price - b.price);
  return more[0] || null;
}

// Everything a Reinvest card needs, or null when the balance covers no plan.
export function reinvestPick(plans, balUsd) {
  const list = plans || [];
  const best = bestPlan(list, balUsd);
  if (!best) return null;
  const next = nextPlan(list, balUsd);
  return {
    plan: best,
    left: Math.max(0, balUsd - best.price),
    count: list.filter((p) => p.price <= balUsd).length,
    next,
    short: next ? next.price - balUsd : 0,
  };
}

// ---- Smart bundle -----------------------------------------------------------------------------------------------
// The catalogue has gaps (for example nothing between $27 and $215). When the best plan would leave most of the
// balance unused, suggest a custom bundle instead: the most hash power the balance can pay for.

export const BUNDLE_MIN_USD = 10; // no bundle suggestions below this
export const BUNDLE_TERM = 180; // default term; the person can change it on the sheet
export const BUNDLE_HEADROOM = 0.01; // keep 1% back so a small BTC price move cannot make the balance fall short
export const SMART_FILL = 0.8; // a catalogue plan that uses at least this share of the balance is kept

// Sizes the Custom slider can land on: 0.5 steps under 10, whole TH to 100, steps of 5 to 500, then steps of 10.
export const SLIDER_SIZES = (() => {
  const a = [];
  for (let t = CUSTOM.min; t <= CUSTOM.max; t += t < 10 ? 0.5 : t < 100 ? 1 : t < 500 ? 5 : 10) a.push(t);
  return a;
})();

// The biggest custom size the balance pays for on the given term, or null. Price is not steady across hall
// boundaries (a bigger size can be cheaper per TH), so every size is checked.
export function bundleFor(balUsd, term = BUNDLE_TERM, hallMap = HALLS) {
  if (!(balUsd >= BUNDLE_MIN_USD) || !CUSTOM.terms.includes(term)) return null;
  const cap = balUsd * (1 - BUNDLE_HEADROOM);
  let best = null;
  for (const th of SLIDER_SIZES) {
    const p = customPlan(th, term, hallMap);
    if (p.price <= cap + 1e-9) best = p;
  }
  return best && best.price >= BUNDLE_MIN_USD ? best : null;
}

// Slider position (0 to 1000) that lands on a size from SLIDER_SIZES, so the Custom sheet can open on it.
export function posFromTh(th) {
  const guess = Math.round((1000 * Math.log(th / CUSTOM.min)) / Math.log(CUSTOM.max / CUSTOM.min));
  for (let d = 0; d <= 10; d++) {
    for (const p of [guess + d, guess - d]) if (p >= 0 && p <= 1000 && thFromPos(p) === th) return p;
  }
  return Math.min(1000, Math.max(0, guess));
}

const r2 = (n) => Math.round(n * 100) / 100;

// Same shape as reinvestPick plus `custom`. `plan` is a catalogue plan, or a custom bundle (id 'custom') when that
// uses clearly more of the balance. Cards call this instead of reinvestPick.
export function smartPick(plans, balUsd, hallMap = HALLS, term = BUNDLE_TERM) {
  const base = reinvestPick(plans, balUsd);
  if (base && base.plan.price >= SMART_FILL * balUsd) return { ...base, custom: false };
  const b = bundleFor(balUsd, term, hallMap);
  if (!b || (base && b.price <= base.plan.price)) return base ? { ...base, custom: false } : null;
  const next = nextPlan(plans || [], balUsd);
  return {
    plan: b,
    custom: true,
    left: Math.max(0, r2(balUsd - b.price)),
    count: base ? base.count : 0,
    next,
    short: next ? next.price - balUsd : 0,
  };
}

// Pass the t function to get the translated title; without it the English text is returned (tests use that).
export const reinvestTitle = (pick, t) => {
  if (t) {
    if (pick.custom) return t('rein.bundle', { th: fmtTh(pick.plan.th) });
    const k = `tier.${pick.plan.id}`;
    const tr = t(k);
    return t('rein.plan', { name: tr === k ? pick.plan.name : tr, th: pick.plan.th });
  }
  return pick.custom ? `Reinvest in a ${fmtTh(pick.plan.th)} TH/s bundle` : `Reinvest in ${pick.plan.name} · ${pick.plan.th} TH/s`;
};

export const reinvestHref = (pick) =>
  pick.custom ? `/plans?plan=custom&th=${pick.plan.th}&days=${pick.plan.days}` : `/plans?plan=${pick.plan.id}`;
