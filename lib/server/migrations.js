// Database migrations, applied in order at boot by lib/server/migrate.js. Add new ones to the end; never edit one that has shipped.
// (SQL lives in JS, not .sql files, so it is bundled into the standalone Docker build.)
export const MIGRATIONS = [
  {
    id: '001_init',
    sql: `
-- Opus Cloud Mining: first real schema. Safe to run on a fresh database or next to the old opus_* tables,
-- which are left untouched (the old single-process store; see lib/server/migrate.js).
--
--   users     one row per account. "data" is the account document (miners, history, notifications, KYC, ...).
--             Every change runs in a transaction that locks the row first (SELECT ... FOR UPDATE), so two
--             servers can never change the same account at the same time.
--   codes     every invite code, unique across all users, so a code can be looked up without scanning users.
--   orders    crypto payment orders. Kept out of the user document so the payment webhook can find an order by id.
--   ledger    append-only record of every balance movement (spend, withdrawal, payment). Used for audits.
--   meta      small shared settings: catalogue, referral settings, admin account, session key.
--   idem      results of Idempotency-Key requests, shared by all servers.
--   throttle  failed sign-in counters, shared by all servers.

CREATE TABLE IF NOT EXISTS users (
  id         text PRIMARY KEY,
  data       jsonb NOT NULL,
  ref_by     text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_ref_by_idx ON users (ref_by) WHERE ref_by IS NOT NULL;

CREATE TABLE IF NOT EXISTS codes (
  code    text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS codes_user_idx ON codes (user_id);

CREATE TABLE IF NOT EXISTS orders (
  id      text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status  text NOT NULL,
  at      bigint NOT NULL,
  data    jsonb NOT NULL,
  idem_key text
);
CREATE UNIQUE INDEX IF NOT EXISTS orders_idem_idx ON orders (idem_key) WHERE idem_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_user_idx ON orders (user_id, at DESC);
CREATE INDEX IF NOT EXISTS orders_open_idx ON orders (status) WHERE status IN ('pending', 'review');

CREATE TABLE IF NOT EXISTS ledger (
  id      bigserial PRIMARY KEY,
  user_id text NOT NULL,
  kind    text NOT NULL,
  btc     numeric(20, 8) NOT NULL DEFAULT 0,
  usd     numeric(14, 2),
  ref     text,
  at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_user_idx ON ledger (user_id, id DESC);

CREATE TABLE IF NOT EXISTS meta (
  key        text PRIMARY KEY,
  data       jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idem (
  key    text PRIMARY KEY,
  result jsonb NOT NULL,
  at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idem_at_idx ON idem (at);

CREATE TABLE IF NOT EXISTS throttle (
  key      text PRIMARY KEY,
  n        integer NOT NULL,
  until_ms bigint NOT NULL
);

-- Miner serial numbers (OP-0004389, ...). A sequence hands out each number exactly once across all servers.
-- lib/server/migrate.js raises it above the sample miners' serials on first boot.
CREATE SEQUENCE IF NOT EXISTS serial_seq START 1;

-- Keep the admin account, catalogue, referral settings and session key from the old store, so the admin does not have
-- to be set up again and signed-in sessions stay valid. Accounts themselves are not copied (they were test accounts).
DO $$
BEGIN
  IF to_regclass('public.opus_meta') IS NOT NULL THEN
    INSERT INTO meta (key, data)
    SELECT key, data FROM opus_meta WHERE key IN ('catalog', 'referral', 'admin', 'adminlog', 'authkey')
    ON CONFLICT (key) DO NOTHING;
  END IF;
END $$;
`,
  },
];
