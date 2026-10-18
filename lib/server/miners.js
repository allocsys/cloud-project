// Plan catalogue, the user's miners and buying a plan. Storage lives in lib/server/db.js.
import { plans, halls } from '@/lib/data';
import { makeContract } from '@/lib/contracts';
import { userOf, idem, remember, peekSerial, takeSerial } from '@/lib/server/db';

export const getCatalog = () => ({ plans, halls });

// `nextSerial` is only a preview for the buy sheet; the real serial is assigned at purchase.
export function getMiners(userId = 'demo') {
  return { contracts: userOf(userId).contracts, nextSerial: peekSerial() };
}

export const getMiner = (serial, userId = 'demo') => userOf(userId).contracts.find((c) => c.serial === serial) || null;

// Same Idempotency-Key twice returns the first result instead of buying twice.
export function buyPlan(input, { userId = 'demo', key } = {}) {
  const idemKey = key ? `buy:${userId}:${key}` : null;
  if (idemKey && idem.has(idemKey)) return idem.get(idemKey);

  const plan = plans.find((p) => p.id === String(input?.planId ?? ''));
  if (!plan) return { ok: false, status: 400, error: 'Unknown plan.' };

  // TODO: take payment here (card, crypto invoice, balance) and only activate once it clears.
  const u = userOf(userId);
  const contract = makeContract(plan, takeSerial());
  const entry = { kind: 'purchase', label: `${plan.name} plan`, date: 'Just now', at: Date.now(), amount: `-$${plan.price}` };
  u.contracts.push(contract);
  u.history.unshift(entry);

  const result = { ok: true, status: 200, contract, entry };
  return idemKey ? remember(idemKey, result) : result;
}
