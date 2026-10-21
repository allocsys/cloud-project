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
  {
    id: '002_withdrawals',
    sql: `
-- One row per withdrawal request. The balance is reserved when the request is made (users.data.withdrawn);
-- an admin approves it, the payout is made, and the status moves pending -> approved -> sent. A rejected or failed
-- request gives the reserved amount back. "data" holds the details (coin, network, address, amounts, fees, notes).
CREATE TABLE IF NOT EXISTS withdrawals (
  id      text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status  text NOT NULL CHECK (status IN ('pending', 'approved', 'sent', 'failed', 'rejected')),
  at      bigint NOT NULL,
  data    jsonb NOT NULL,
  idem_key text
);
CREATE UNIQUE INDEX IF NOT EXISTS withdrawals_idem_idx ON withdrawals (idem_key) WHERE idem_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS withdrawals_user_idx ON withdrawals (user_id, at DESC);
CREATE INDEX IF NOT EXISTS withdrawals_open_idx ON withdrawals (status) WHERE status IN ('pending', 'approved');
`,
  },
  {
    id: '003_account_close',
    sql: `
-- Closing an account gives its row a new, random id (closed:...) so the email or Telegram id is gone while payment
-- orders and withdrawal records stay for the books. The three tables that point at users follow the new id.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_user_id_fkey;
ALTER TABLE orders ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE withdrawals DROP CONSTRAINT IF EXISTS withdrawals_user_id_fkey;
ALTER TABLE withdrawals ADD CONSTRAINT withdrawals_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE codes DROP CONSTRAINT IF EXISTS codes_user_id_fkey;
ALTER TABLE codes ADD CONSTRAINT codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE;
`,
  },
  {
    id: '004_abilene_catalog',
    sql: `
-- The saved (admin-edited) catalogue overrides the defaults in lib/data.js, so the Texas hall's corrected net rate and the
-- Basic plan's daily label never reached it. Fix just those two values, once. Nothing happens when no catalogue was saved:
-- the defaults in lib/data.js already have the right numbers.
UPDATE meta SET data = jsonb_set(data, '{halls,tx-1,net}', '0.021'::jsonb), updated_at = now()
WHERE key = 'catalog' AND data #> '{halls,tx-1}' IS NOT NULL;
UPDATE meta SET updated_at = now(), data = jsonb_set(data, '{plans}', (
  SELECT jsonb_agg(CASE WHEN t.p->>'id' = 'basic' THEN jsonb_set(t.p, '{daily}', to_jsonb('$1.26'::text)) ELSE t.p END ORDER BY t.ord)
  FROM jsonb_array_elements(data->'plans') WITH ORDINALITY AS t(p, ord)
))
WHERE key = 'catalog' AND jsonb_typeof(data->'plans') = 'array';
`,
  },
  {
    id: '005_market_days',
    sql: `
-- One row per UTC day: the market that day's mining payout is worked out from. Today's row follows the live feed and is
-- rewritten every few minutes; once the day is over nothing writes to it again, so a paid day never changes.
-- day is the UTC midnight in milliseconds. gross_per_th is USD per TH/s per day before electricity and maintenance.
CREATE TABLE IF NOT EXISTS market_days (
  day          bigint PRIMARY KEY,
  btc_usd      numeric(14, 2) NOT NULL,
  difficulty   numeric(24, 0) NOT NULL,
  gross_per_th numeric(12, 8) NOT NULL,
  at           bigint NOT NULL
);
`,
  },
  {
    id: '006_hash_samples',
    sql: `
-- What each miner really hashed, as reported by its mining hall (POST /api/telemetry, see lib/server/telemetry.js).
-- One row per miner and moment: at is milliseconds since 1970, th is the TH/s measured then. The hashrate and uptime
-- charts are worked out from these rows when the admin has the mock charts switch off. Old rows are pruned.
CREATE TABLE IF NOT EXISTS hash_samples (
  serial text   NOT NULL,
  at     bigint NOT NULL,
  th     numeric(12, 3) NOT NULL,
  PRIMARY KEY (serial, at)
);
CREATE INDEX IF NOT EXISTS hash_samples_at_idx ON hash_samples (at);
`,
  },
  {
    id: '007_performance_indexes',
    sql: `
-- Performance optimization indexes for frequently queried patterns.
-- users: created_at for pagination, ref_by for referral lookups
CREATE INDEX IF NOT EXISTS users_created_at_idx ON users (created_at);

-- ledger: composite index for user balance queries and history
CREATE INDEX IF NOT EXISTS ledger_user_kind_at_idx ON ledger (user_id, kind, at DESC);

-- orders: composite index for user order history with status filtering
CREATE INDEX IF NOT EXISTS orders_user_status_at_idx ON orders (user_id, status, at DESC);

-- withdrawals: composite index for user withdrawal history
CREATE INDEX IF NOT EXISTS withdrawals_user_status_at_idx ON withdrawals (user_id, status, at DESC);

-- codes: index for code lookup by user
CREATE INDEX IF NOT EXISTS codes_user_id_idx ON codes (user_id);

-- throttle: index for cleanup queries
CREATE INDEX IF NOT EXISTS throttle_until_ms_idx ON throttle (until_ms);

-- idem: index for expiration cleanup
CREATE INDEX IF NOT EXISTS idem_at_idx ON idem (at);
`,
  },
];
