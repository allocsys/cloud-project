// Recent wallet deposits cannot be withdrawn while the account has no plan (DEPOSIT_HOLD_DAYS in lib/rules.js).
// Every deposit counts from its own day: u.lots = [{ at, btc }] holds the ones still inside the hold. Pure, no database.
import { DEPOSIT_HOLD_DAYS } from '@/lib/rules';

const HOLD_MS = DEPOSIT_HOLD_DAYS * 86_400_000;

// A plan was bought. A refunded plan does not count: its purchase row stays in the activity but is marked refunded.
export const hasPlan = (u) => (u.history || []).some((h) => h.kind === 'purchase' && !h.refunded);

// Deposits still inside the hold. An account from before lots were saved is read from its deposit rows.
export function lotsOf(u, now = Date.now()) {
  const all = u.lots || (u.history || []).filter((h) => h.kind === 'deposit' && h.at).map((h) => ({ at: h.at, btc: parseFloat(h.amount) || 0 }));
  return all.filter((l) => l.at + HOLD_MS > now);
}

// Records a paid deposit and drops the lots that are already free.
export function addLot(u, btc, at = Date.now()) {
  u.lots = [...lotsOf(u, at), { at, btc }];
}

// BTC of the balance that cannot be withdrawn (or spent on a boost) yet. Zero once the account has a plan.
export function lockedBtc(u, now = Date.now()) {
  return hasPlan(u) ? 0 : lotsOf(u, now).reduce((s, l) => s + l.btc, 0);
}
