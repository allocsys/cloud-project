// In-memory store shared by the wallet and miners code (resets on deploy).
// Swap this file for Postgres on Railway: keep userOf(id) and the serial helpers.
import { history as seedHistory, contracts as seedContracts } from '@/lib/data';
import { formatSerial, serialNumber } from '@/lib/contracts';

const db = (globalThis.__opusDb ||= { users: new Map(), idem: new Map() });
db.serial ??= Math.max(...seedContracts.map((c) => serialNumber(c.serial)));

export const idem = db.idem;

// Single demo user until real auth lands: pass the signed-in user's id.
export function userOf(id = 'demo') {
  let u = db.users.get(id);
  if (!u) {
    u = { id, withdrawn: 0, history: seedHistory.map((h) => ({ ...h })), contracts: seedContracts.map((c) => ({ ...c })) };
    db.users.set(id, u);
  }
  if (!u.contracts) u.contracts = seedContracts.map((c) => ({ ...c }));
  return u;
}

export const peekSerial = () => formatSerial(db.serial + 1);
export const takeSerial = () => formatSerial((db.serial += 1));

// Remember a result for an Idempotency-Key, keeping the map from growing forever.
export function remember(key, result) {
  idem.set(key, result);
  if (idem.size > 500) idem.delete(idem.keys().next().value);
  return result;
}
