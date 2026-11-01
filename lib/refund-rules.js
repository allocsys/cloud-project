// Refund requests: the questions and the window. Shared by the server and the miner page.
import { REFUND_HOURS } from '@/lib/rules';

export const REFUND_MS = REFUND_HOURS * 3600 * 1000;
const DAY_MS = 86400000;

// The pick-one answers. The texts live in the language files (rr.r.<id> and rr.a.<id>).
export const REASONS = ['mistake', 'wrong', 'low', 'better', 'money', 'broken', 'other'];
export const AGAIN = ['yes', 'maybe', 'no'];
export const NOTE_MAX = 500;
export const DECISION_NOTE_MAX = 200;

// The last moment a refund can be asked for this miner: the refund window after it started, or the end of the UTC day it
// started on (its first payout day), whichever comes first. The same two rules refundMiner (lib/server/admin.js) applies.
// null for miners that are never refunded: gifts and miners with no purchase record.
export function refundDeadline(m) {
  if (!m || m.bonus || !Number.isFinite(m.startedAt) || !(m.price > 0)) return null;
  return Math.min(m.startedAt + REFUND_MS, (Math.floor(m.startedAt / DAY_MS) + 1) * DAY_MS - 1);
}

export const refundWindowText = () => `Refunds are open ${REFUND_HOURS} hours after buying, until the first payout day ends.`;
