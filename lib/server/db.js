// Data layer. Postgres is the only source of truth, so any number of servers can run side by side.
//
//   Reading:   getUser(id) returns a snapshot of an account. It never locks and never writes (except creating the demo
//              account the first time it is asked for).
//   Changing:  withUser(id, fn) / withUsers([ids], fn) open a transaction, lock the account row(s), run fn on the
//              account document(s), save whatever fn changed and commit. Two servers changing the same account queue up
//              on the row lock, so a balance check and the spend that follows can never interleave.
//              Accounts are always locked in sorted id order, so two requests can never deadlock on each other.
//   Shared:    meta (catalogue, referral settings, admin account, session key), serial numbers, idempotency keys and
//              sign-in throttling all live in Postgres too, see lib/server/migrations.js.
//
// Rules for code that changes money or miners: do it inside withUser/withUsers, never do network calls inside them
// (the transaction can be retried and the lock is held meanwhile), and write a ledger row for every balance movement.
import pg from 'pg';
import { contracts as seedContracts, halls } from '@/lib/data';
import { formatSerial, serialNumber } from '@/lib/contracts';

const g = (globalThis.__opusPg ||= { pool: null, meta: { at: 0, data: {}, inflight: null, ver: 0 } });

export function pool() {
  if (!g.pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set.');
    g.pool = new pg.Pool({
      connectionString: url,
      max: Number(process.env.PG_POOL_MAX) || 10,
      connectionTimeoutMillis: 8000,
      idleTimeoutMillis: 30_000,
    });
    g.pool.on('error', (e) => console.error('[db] pool error:', e.message));
  }
  return g.pool;
}

export const q = (text, params, c = pool()) => c.query(text, params);

// Runs fn(client) in a transaction. A deadlock or serialization failure retries the whole function, so fn must only
// touch the database (no network calls, no sending mail).
export async function tx(fn) {
  for (let attempt = 0; ; attempt += 1) {
    const c = await pool().connect();
    try {
      await c.query('BEGIN');
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      try {
        await c.query('ROLLBACK');
      } catch {}
      if ((e.code === '40001' || e.code === '40P01') && attempt < 3) continue;
      throw e;
    } finally {
      c.release();
    }
  }
}

// ---- Shared settings (meta) ----
// Cached in memory for a few seconds so the many synchronous reads (catalog(), settings()) stay cheap. A change made
// on one server reaches the others within META_TTL; the server that made it sees it at once.

const META_TTL = 3000;
const meta = g.meta;
meta.ver ??= 0; // counts the changes made on this server, so a read that started before one can be told apart

// One read of the whole meta table. A change made here while the read was running may be missing from it, so such a read is
// thrown away and repeated: it must never put an older value over a newer one.
async function readMeta() {
  for (let i = 0; i < 3; i += 1) {
    const ver = meta.ver;
    const r = await pool().query('SELECT key, data FROM meta');
    if (ver !== meta.ver) continue;
    const data = {};
    r.rows.forEach((row) => (data[row.key] = row.data));
    meta.data = data;
    meta.at = Date.now();
    return;
  }
}

export async function warm(force = false) {
  if (!force && Date.now() - meta.at < META_TTL) return;
  // A forced refresh must not reuse a read that started before the latest change: wait it out, then read again.
  if (force && meta.inflight) await meta.inflight.catch(() => {});
  if (!meta.inflight) meta.inflight = readMeta().finally(() => (meta.inflight = null));
  return meta.inflight;
}

export const metaGet = (key) => meta.data[key];

// The local copy follows a change only once it is committed (value undefined = removed).
function remember(key, value) {
  meta.ver += 1;
  const next = { ...meta.data };
  if (value === undefined) delete next[key];
  else next[key] = value;
  meta.data = next;
}

// Pass `c` only inside a transaction you will commit: the local copy is then left alone, and the caller updates it after the
// commit (metaUpdate does), so a rolled-back change never shows.
export async function metaSet(key, value, c) {
  await (c || pool()).query('INSERT INTO meta (key, data) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()', [key, JSON.stringify(value)]);
  if (!c) remember(key, value);
}

export async function metaDelete(key, c) {
  await (c || pool()).query('DELETE FROM meta WHERE key = $1', [key]);
  if (!c) remember(key, undefined);
}

// Read-modify-write of one meta entry under a lock. fn(current) returns { value, result }: value is saved when it is
// not undefined, result is what metaUpdate returns.
export async function metaUpdate(key, fn) {
  let saved = null; // what the last attempt wrote (a retried attempt starts over)
  const result = await tx(async (c) => {
    saved = null;
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`meta:${key}`]);
    const r = await c.query('SELECT data FROM meta WHERE key = $1', [key]);
    const out = await fn(r.rows[0]?.data);
    if (out?.value !== undefined) {
      await metaSet(key, out.value, c);
      saved = { value: out.value };
    }
    return out?.result;
  });
  if (saved) remember(key, saved.value);
  return result;
}

// The live catalogue: the halls and their net rates. Until an admin edits it, this is the defaults in lib/data.js.
// Never mutate what this returns. There are no fixed plans any more: ASICs power is priced from the halls (customPlan).
export const catalog = () => meta.data.catalog || { halls };

// ---- Accounts ----

// Fills in defaults and brings older documents up to date. Pure: it never touches the database.
// Every account starts empty, the demo one included. The admin screen can wipe the demo account back to this state.
export function hydrate(id, data) {
  const u = data ? { ...data } : { withdrawn: 0, history: [] };
  u.id = id;
  u.withdrawn ??= 0;
  u.history ??= [];
  if (!u.contracts) u.contracts = [];
  if (!u.notifications) u.notifications = [];
  if (!u.kyc) u.kyc = { status: 'none' };
  // Catalogue v2 (realistic miners): saved miners get their daily payout from their hall's net rate.
  if (u.cv !== 3) {
    u.contracts.forEach((c) => {
      const h = catalog().halls[c.hall];
      if (h) c.dailyUsd = Math.round(c.th * h.net * 100) / 100;
    });
    u.cv = 3;
  }
  return u;
}

// Creates the demo account (empty) the first time anyone asks for it.
async function ensureDemo(c) {
  const u = hydrate('demo', null);
  u.refCode = 'OPUS-7K2M';
  await c.query('INSERT INTO users (id, data) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO NOTHING', ['demo', JSON.stringify(u)]);
  await c.query("INSERT INTO codes (code, user_id) VALUES ('OPUS-7K2M', 'demo') ON CONFLICT DO NOTHING");
}

// A snapshot of an account for reading. Unknown ids (other than demo) come back as an empty, unsaved account.
export async function getUser(id = 'demo', c = pool()) {
  await warm();
  let r = await c.query('SELECT data FROM users WHERE id = $1', [id]);
  if (!r.rows[0] && id === 'demo') {
    await ensureDemo(c);
    r = await c.query('SELECT data FROM users WHERE id = $1', [id]);
  }
  return hydrate(id, r.rows[0]?.data || null);
}

export async function userExists(id, c = pool()) {
  const r = await c.query('SELECT 1 FROM users WHERE id = $1', [id]);
  return r.rowCount > 0;
}

// Accounts whose ref_by is this id (an inviter's friends), as snapshots.
export async function friendsOf(id, c = pool()) {
  await warm();
  const r = await c.query('SELECT data FROM users WHERE ref_by = $1 ORDER BY created_at DESC', [id]);
  return r.rows.map((row) => hydrate(row.data.id, row.data));
}

// Every account id, oldest first. For admin screens and bulk actions, so keep callers rare.
export async function allUserIds(c = pool()) {
  const r = await c.query('SELECT id FROM users ORDER BY created_at, id');
  return r.rows.map((row) => row.id);
}

export async function allUsers(limit = 1000, c = pool()) {
  await warm();
  if (!(await c.query('SELECT 1 FROM users LIMIT 1')).rowCount) await ensureDemo(c);
  const r = await c.query('SELECT data FROM users ORDER BY created_at, id LIMIT $1', [limit]);
  return r.rows.map((row) => hydrate(row.data.id, row.data));
}

async function save(c, u, before) {
  const json = JSON.stringify(u);
  if (json === before) return;
  await c.query('UPDATE users SET data = $2::jsonb, ref_by = $3, updated_at = now() WHERE id = $1', [u.id, json, u.refBy || null]);
}

// Writes an account document unconditionally (for code that built or changed one outside withUsers).
export const saveUser = (c, u) => save(c, u, null);

// Inserts a new account. Returns null when the id is taken, so two sign-ups with the same email cannot both win.
export async function createUser(c, id, init = {}) {
  const u = hydrate(id, null);
  Object.assign(u, init, { id, createdAt: Date.now() });
  const r = await c.query('INSERT INTO users (id, data, ref_by) VALUES ($1, $2::jsonb, $3) ON CONFLICT (id) DO NOTHING', [id, JSON.stringify(u), u.refBy || null]);
  return r.rowCount ? u : null;
}

// Same as withUsers, inside a transaction the caller already opened (for example while signing up).
export async function usersIn(c, ids, fn) {
  const list = [...new Set(ids.filter(Boolean))].sort();
  if (list.includes('demo')) await ensureDemo(c);
  const r = await c.query('SELECT id, data FROM users WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE', [list]);
  const map = new Map();
  const before = new Map();
  for (const row of r.rows) {
    const u = hydrate(row.id, row.data);
    map.set(row.id, u);
    before.set(row.id, JSON.stringify(u));
  }
  const out = await fn(map, c);
  for (const [id, u] of map) await save(c, u, before.get(id));
  return out;
}

// Locks the accounts (sorted by id), runs fn(map, client) and saves every account fn changed.
// Missing accounts are not created: they are simply absent from the map (except demo, which is created on demand).
export async function withUsers(ids, fn) {
  await warm();
  return tx((c) => usersIn(c, ids, fn));
}

// One account: fn(user, client). The user is null when the account does not exist.
export const withUser = (id, fn) => withUsers([id], (map, c) => fn(map.get(id) || null, c));

// Pushes an unread notification to the top. Keeps the newest 50.
export function notify(u, n) {
  u.notifications.unshift({ id: `n${Date.now()}${Math.random().toString(36).slice(2, 6)}`, read: false, at: Date.now(), ...n });
  if (u.notifications.length > 50) u.notifications.length = 50;
}

// ---- Invite codes ----

// Reserves a code for an account. False when somebody already owns it.
export async function claimCode(c, code, userId) {
  const r = await c.query('INSERT INTO codes (code, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [code.toUpperCase(), userId]);
  return r.rowCount > 0;
}

export async function releaseCode(c, code) {
  await c.query('DELETE FROM codes WHERE code = $1', [code.toUpperCase()]);
}

export async function codeOwner(code, c = pool()) {
  const r = await c.query('SELECT user_id FROM codes WHERE code = $1', [String(code || '').trim().toUpperCase()]);
  return r.rows[0]?.user_id || null;
}

// ---- Serial numbers ----

export async function takeSerial(c) {
  const r = await c.query("SELECT nextval('serial_seq') AS n");
  return formatSerial(Number(r.rows[0].n));
}

// Only a preview for the buy sheet: another purchase may take it first.
export async function peekSerial(c = pool()) {
  const r = await c.query('SELECT last_value, is_called FROM serial_seq');
  const { last_value, is_called } = r.rows[0];
  return formatSerial(Number(last_value) + (is_called ? 1 : 0));
}

// Lifts the sequence above the sample miners' serials once, on first boot.
export async function raiseSerialFloor(c = pool()) {
  const floor = Math.max(...seedContracts.map((x) => serialNumber(x.serial)));
  const r = await c.query('SELECT last_value, is_called FROM serial_seq');
  if (!r.rows[0].is_called && Number(r.rows[0].last_value) <= floor) await c.query("SELECT setval('serial_seq', $1)", [floor]);
}

// ---- Ledger ----
// One row for every balance movement. kind: spend (plan paid from balance), withdrawal, payment (crypto order settled).

export async function ledger(c, userId, kind, { btc = 0, usd = null, ref = null } = {}) {
  await c.query('INSERT INTO ledger (user_id, kind, btc, usd, ref) VALUES ($1, $2, $3, $4, $5)', [userId, kind, btc.toFixed(8), usd === null ? null : usd.toFixed(2), ref]);
}

// ---- Idempotency ----
// Same key twice returns the first result instead of repeating the action. Run it inside the same transaction as the
// action, so the stored result and the change commit together. The advisory lock makes a second request with the
// same key wait for the first, on any server.

// Quick check before doing any slow work: the stored result for a key, or null.
export async function idemGet(key, c = pool()) {
  if (!key) return null;
  const r = await c.query('SELECT result FROM idem WHERE key = $1', [key]);
  return r.rows[0]?.result || null;
}

export async function withIdem(c, key, fn) {
  if (!key) return fn();
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
  const hit = await c.query('SELECT result FROM idem WHERE key = $1', [key]);
  if (hit.rows[0]) return hit.rows[0].result;
  const result = await fn();
  if (result?.ok) {
    await c.query('INSERT INTO idem (key, result) VALUES ($1, $2::jsonb) ON CONFLICT DO NOTHING', [key, JSON.stringify(result)]);
    if (Math.random() < 0.01) await c.query("DELETE FROM idem WHERE at < now() - interval '3 days'");
  }
  return result;
}

// ---- Sign-in throttling ----
// After `max` failures a key is locked for 15 minutes. Shared by all servers.

const LOCK_MS = 15 * 60_000;

export async function throttled(key, max) {
  const r = await q('SELECT n, until_ms FROM throttle WHERE key = $1', [key]);
  const t = r.rows[0];
  return !!t && t.n >= max && Date.now() < Number(t.until_ms);
}

export async function noteFail(key) {
  const now = Date.now();
  await q(
    `INSERT INTO throttle (key, n, until_ms) VALUES ($1, 1, $2)
     ON CONFLICT (key) DO UPDATE SET
       n = CASE WHEN throttle.until_ms < $3 THEN 1 ELSE throttle.n + 1 END,
       until_ms = CASE WHEN throttle.until_ms < $3 THEN $2 ELSE throttle.until_ms END`,
    [key, now + LOCK_MS, now],
  );
  if (Math.random() < 0.02) await q('DELETE FROM throttle WHERE until_ms < $1', [now]);
}

export const clearFails = (key) => q('DELETE FROM throttle WHERE key = $1', [key]);

// Counts one attempt in a single statement and says whether the key is now over `max`. Checking with throttled() and counting
// later with noteFail() lets a burst of parallel requests all pass the check; this counts them exactly, on any number of servers.
// An attempt that turns out not to be a failure is given back with release().
export async function hit(key, max) {
  const now = Date.now();
  const r = await q(
    `INSERT INTO throttle (key, n, until_ms) VALUES ($1, 1, $2)
     ON CONFLICT (key) DO UPDATE SET
       n = CASE WHEN throttle.until_ms < $3 THEN 1 ELSE throttle.n + 1 END,
       until_ms = CASE WHEN throttle.until_ms < $3 THEN $2 ELSE throttle.until_ms END
     RETURNING n`,
    [key, now + LOCK_MS, now],
  );
  if (Math.random() < 0.02) await q('DELETE FROM throttle WHERE until_ms < $1', [now]);
  return Number(r.rows[0].n) > max;
}

export const release = (key) => q('UPDATE throttle SET n = GREATEST(n - 1, 0) WHERE key = $1', [key]);
