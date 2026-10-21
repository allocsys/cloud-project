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
import { history as seedHistory, contracts as seedContracts, notifications as seedNotifications, halls, plans, SEED_WITHDRAWN } from '@/lib/data';
import { formatSerial, serialNumber } from '@/lib/contracts';

const g = (globalThis.__opusPg ||= { pool: null, meta: { at: 0, data: {}, inflight: null } });

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

export async function warm(force = false) {
  if (!force && Date.now() - meta.at < META_TTL) return;
  if (!meta.inflight) {
    meta.inflight = pool()
      .query('SELECT key, data FROM meta')
      .then((r) => {
        const data = {};
        r.rows.forEach((row) => (data[row.key] = row.data));
        meta.data = data;
        meta.at = Date.now();
      })
      .finally(() => (meta.inflight = null));
  }
  return meta.inflight;
}

export const metaGet = (key) => meta.data[key];

export async function metaSet(key, value, c = pool()) {
  await c.query('INSERT INTO meta (key, data) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()', [key, JSON.stringify(value)]);
  meta.data = { ...meta.data, [key]: value };
}

export async function metaDelete(key, c = pool()) {
  await c.query('DELETE FROM meta WHERE key = $1', [key]);
  const next = { ...meta.data };
  delete next[key];
  meta.data = next;
}

// Read-modify-write of one meta entry under a lock. fn(current) returns { value, result }: value is saved when it is
// not undefined, result is what metaUpdate returns.
export async function metaUpdate(key, fn) {
  return tx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`meta:${key}`]);
    const r = await c.query('SELECT data FROM meta WHERE key = $1', [key]);
    const out = await fn(r.rows[0]?.data);
    if (out?.value !== undefined) await metaSet(key, out.value, c);
    return out?.result;
  });
}

// The live catalogue. Until an admin edits it, this is the defaults in lib/data.js. Never mutate what this returns.
export const catalog = () => meta.data.catalog || { plans, halls };

// ---- Accounts ----

const freshContracts = () => seedContracts.map((c) => ({ ...c }));
const freshNotifications = () => seedNotifications.map((n) => ({ ...n, read: false }));

// Fills in defaults and brings older documents up to date. Pure: it never touches the database.
// Only the demo user gets the sample history, miners and notifications; every real account starts empty.
export function hydrate(id, data) {
  const demo = id === 'demo';
  const u = data ? { ...data } : { withdrawn: demo ? SEED_WITHDRAWN : 0, history: demo ? seedHistory.map((h) => ({ ...h })) : [] };
  u.id = id;
  u.withdrawn ??= 0;
  u.history ??= [];
  if (!u.contracts) u.contracts = demo ? freshContracts() : [];
  if (!u.notifications) u.notifications = demo ? freshNotifications() : [];
  if (!u.kyc) u.kyc = { status: 'none' };
  // Catalogue v2 (realistic miners): saved miners get their daily payout from their hall's net rate.
  if (u.cv !== 3) {
    u.contracts.forEach((c) => {
      const p = catalog().plans.find((x) => x.name === c.plan);
      if (p) {
        c.th = p.th;
        c.name = `${p.name} ${p.th} TH/s`;
        c.hall = p.hall;
        if (c.days !== p.days) {
          c.days = p.days;
          const now = new Date();
          const start = new Date(`${c.started} ${now.getFullYear()}`);
          if (!isNaN(start)) {
            if (start > now) start.setFullYear(start.getFullYear() - 1);
            c.ends = new Date(start.getTime() + p.days * 86400000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
          }
        }
      }
      const h = catalog().halls[c.hall];
      if (h) c.dailyUsd = Math.round(c.th * h.net * 100) / 100;
    });
    u.cv = 3;
  }
  return u;
}

// Creates the demo account the first time anyone asks for it (its sample data comes from lib/data.js).
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
// Pagination support: offset and limit for large datasets
export async function allUserIds(c = pool(), offset = 0, limit = null) {
  const query = limit ? 'SELECT id FROM users ORDER BY created_at, id OFFSET $1 LIMIT $2' : 'SELECT id FROM users ORDER BY created_at, id OFFSET $1';
  const params = limit ? [offset, limit] : [offset];
  const r = await c.query(query, params);
  return r.rows.map((row) => row.id);
}

// Pagination support: cursor-based pagination for better performance
export async function allUsers(limit = 1000, c = pool(), cursor = null) {
  await warm();
  if (!(await c.query('SELECT 1 FROM users LIMIT 1')).rowCount) await ensureDemo(c);
  
  let query = 'SELECT data FROM users';
  const params = [];
  
  if (cursor) {
    query += ' WHERE created_at > $1 OR (created_at = $1 AND id > $2)';
    params.push(cursor.created_at, cursor.id);
  }
  
  query += ' ORDER BY created_at, id LIMIT $' + (params.length + 1);
  params.push(limit);
  
  const r = await c.query(query, params);
  return r.rows.map((row) => hydrate(row.data.id, row.data));
}

// Get total user count for pagination metadata
export async function getUserCount(c = pool()) {
  const r = await c.query('SELECT COUNT(*)::int AS count FROM users');
  return r.rows[0]?.count || 0;
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
