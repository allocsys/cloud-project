// In-memory store shared by the wallet, miners and account code (resets on deploy).
// Swap this file for Postgres on Railway: keep userOf(id), notify() and the serial helpers.
import { history as seedHistory, contracts as seedContracts, notifications as seedNotifications } from '@/lib/data';
import { formatSerial, serialNumber } from '@/lib/contracts';

const db = (globalThis.__opusDb ||= { users: new Map(), idem: new Map() });
db.serial ??= Math.max(...seedContracts.map((c) => serialNumber(c.serial)));

export const idem = db.idem;

const freshContracts = () => seedContracts.map((c) => ({ ...c }));
const freshNotifications = () => seedNotifications.map((n) => ({ ...n, read: false }));

// Single demo user until real auth lands: pass the signed-in user's id.
export function userOf(id = 'demo') {
  let u = db.users.get(id);
  if (!u) {
    u = { id, withdrawn: 0, history: seedHistory.map((h) => ({ ...h })) };
    db.users.set(id, u);
  }
  if (!u.contracts) u.contracts = freshContracts();
  if (!u.notifications) u.notifications = freshNotifications();
  return u;
}

export const peekSerial = () => formatSerial(db.serial + 1);
export const takeSerial = () => formatSerial((db.serial += 1));

// Adds an unread notification at the top. Keeps the newest 50.
export function notify(u, n) {
  u.notifications.unshift({ id: `n${Date.now()}${Math.random().toString(36).slice(2, 6)}`, read: false, at: Date.now(), ...n });
  if (u.notifications.length > 50) u.notifications.length = 50;
}

// Remember a result for an Idempotency-Key, keeping the map from growing forever.
export function remember(key, result) {
  idem.set(key, result);
  if (idem.size > 500) idem.delete(idem.keys().next().value);
  return result;
}
