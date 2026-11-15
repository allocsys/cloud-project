// The "Payout received" card on the dashboard. It shows when a new UTC day has started, yesterday paid something and the person
// has not closed the card today. `all` is the daily earnings from /api/dashboard (oldest first, today last), `now` is in ms,
// `seen` is the UTC day number (days since 1970) the card was last closed on, or null while that is not read yet.
// Returns { day, usd } to show, or null.
export function payoutCard(all, now, seen) {
  if (!Number.isFinite(now) || !Array.isArray(all) || all.length < 2) return null;
  if (seen === null || seen === undefined) return null;
  const day = Math.floor(now / 86400000);
  if (seen === day) return null;
  const usd = Number(all[all.length - 2]?.usd);
  return usd > 0 ? { day, usd } : null;
}
