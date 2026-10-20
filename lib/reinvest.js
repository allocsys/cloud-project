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
