// The trap list: who opened /password.txt and who tried to sign in with its fake logins. Kept as the meta entry "traplog" (newest first, 200 at most).
// Cheap by design: one note per address per hour for a file hit, five per hour for sign-in tries, 300 an hour in all (shared throttle in the database).
import { warm, metaGet, metaUpdate, hit } from '@/lib/server/db';
import { isDecoyPass, isDecoyUser } from '@/lib/trap';

export const TRAP_MAX = 200;
const HOUR = 3_600_000;
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').slice(0, n);

// kind: 'file' (opened password.txt), 'login' (app sign-in), 'admin' (admin sign-in). fake = the decoy password was used. The password itself is never stored.
export async function recordTrap(kind, { ip, ua, user = '', fake = false } = {}) {
  const k = kind === 'login' || kind === 'admin' ? kind : 'file';
  const from = clean(ip, 64) || 'unknown';
  if (await hit(`trap:${k}:${from}`, k === 'file' ? 1 : 5, HOUR)) return false;
  if (await hit('trap:all', 300, HOUR)) return false;
  const row = { at: Date.now(), kind: k, ip: from, ua: clean(ua, 160), ...(user ? { user: clean(user, 60) } : {}), ...(fake ? { fake: true } : {}) };
  await metaUpdate('traplog', (cur) => ({ value: [row, ...(cur || [])].slice(0, TRAP_MAX) }));
  return true;
}

// Called from the sign-in routes. Anything that is not the decoy name or password costs two string compares and returns.
export async function decoyTry(kind, user, pass, ip, ua) {
  const fake = isDecoyPass(pass);
  const named = isDecoyUser(user);
  if (!fake && !named) return;
  try {
    await recordTrap(kind, { ip, ua, user: named ? String(user).trim() : '', fake });
  } catch {}
}

export async function trapList() {
  await warm();
  const all = metaGet('traplog') || [];
  return { total: all.length, red: all.filter((r) => r.fake).length, rows: all.slice(0, 50) };
}
