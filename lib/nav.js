// Drill-down history: a screen opened from a list (plan miner card to miner page) adds one
// history entry, so back steps out one screen at a time. Tab switches stay flat (replace).
// The depth counter tells BackGuard how many such entries sit above the spare guard entry.

export function markDrill() {
  window.__opusDepth = (window.__opusDepth || 0) + 1;
}

export function drillBack(router, fallback) {
  if ((window.__opusDepth || 0) > 0) window.history.back();
  else router.replace(fallback);
}
