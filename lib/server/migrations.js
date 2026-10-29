// The database schema, applied at boot by lib/server/migrate.js. It is one baseline (the 15 earlier steps were folded into it while the
// app was in staging). A database that already ran them keeps its tables: '001_init' is already recorded there, so nothing runs again.
// Add new changes as new entries at the end; never edit one that has shipped.
// (SQL lives in JS, not .sql files, so it is bundled into the standalone Docker build.)
export const MIGRATIONS = [
  {
    id: '001_init',
    sql: `
-- Vertexhash schema. Safe to run on a fresh database.
--
--   users        one row per account. "data" is the account document (miners, history, notifications, KYC, ...).
--                Every change runs in a transaction that locks the row first (SELECT ... FOR UPDATE), so two
--                servers can never change the same account at the same time. One account per email.
--   codes        every invite code, unique across all users, so a code can be looked up without scanning users.
--   orders       crypto payment orders. Kept out of the user document so the payment webhook can find an order by id.
--   withdrawals  one row per withdrawal request (pending -> approved -> sent; a rejected or failed one gives the balance back).
--   ledger       append-only record of every balance movement (spend, withdrawal, payment). Used for audits.
--   meta         small shared settings: catalogue, referral settings, admin account, session key.
--   idem         results of Idempotency-Key requests, shared by all servers.
--   throttle     failed sign-in counters, shared by all servers.
--   market_days  one row per UTC day: the BTC market that day's payout is worked out from. Today's row follows the live feed;
--                once the day is over nothing writes to it again. day is the UTC midnight in milliseconds.
--   hash_samples what each miner really hashed, reported by its hall (POST /api/telemetry). Old rows are pruned.
--   smart_coins  the Smart Mining coins (admin edits this list) with each coin's reference rig and electricity price.
--   coin_days    one market row per coin and UTC day; net_per_rig is that day's net profit per reference rig in USD.
--   smart_picks  the coin picked for each finished day, written once and then locked.

CREATE TABLE IF NOT EXISTS users (
  id         text PRIMARY KEY,
  data       jsonb NOT NULL,
  ref_by     text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_ref_by_idx ON users (ref_by) WHERE ref_by IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users ((data->>'email')) WHERE data->>'email' IS NOT NULL;
-- The renew timer and the boost timer ask only for accounts that can have work; the WHERE of each index is the condition
-- their queries use (lib/server/renew.js, lib/server/boost.js settleDue).
CREATE INDEX IF NOT EXISTS users_renew_idx ON users (id) WHERE data->'contracts' @> '[{"renew": true}]'::jsonb;
CREATE INDEX IF NOT EXISTS users_boost_open_idx ON users (id) WHERE data->'boosts' @> '[{"settled": false}]'::jsonb;

-- Closing an account gives its row a new, random id (closed:...), so the tables that point at users follow it (ON UPDATE CASCADE).
CREATE TABLE IF NOT EXISTS codes (
  code    text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS codes_user_idx ON codes (user_id);

CREATE TABLE IF NOT EXISTS orders (
  id      text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  status  text NOT NULL,
  at      bigint NOT NULL,
  data    jsonb NOT NULL,
  idem_key text
);
CREATE UNIQUE INDEX IF NOT EXISTS orders_idem_idx ON orders (idem_key) WHERE idem_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_user_idx ON orders (user_id, at DESC);
CREATE INDEX IF NOT EXISTS orders_open_idx ON orders (status) WHERE status IN ('pending', 'review');

CREATE TABLE IF NOT EXISTS withdrawals (
  id      text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  status  text NOT NULL CHECK (status IN ('pending', 'approved', 'sent', 'failed', 'rejected')),
  at      bigint NOT NULL,
  data    jsonb NOT NULL,
  idem_key text
);
CREATE UNIQUE INDEX IF NOT EXISTS withdrawals_idem_idx ON withdrawals (idem_key) WHERE idem_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS withdrawals_user_idx ON withdrawals (user_id, at DESC);
CREATE INDEX IF NOT EXISTS withdrawals_open_idx ON withdrawals (status) WHERE status IN ('pending', 'approved');

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
CREATE INDEX IF NOT EXISTS throttle_until_idx ON throttle (until_ms);

-- Miner serial numbers (OP-0004389, ...). A sequence hands out each number exactly once across all servers.
-- lib/server/migrate.js raises it above the sample miners' serials on first boot.
CREATE SEQUENCE IF NOT EXISTS serial_seq START 1;

CREATE TABLE IF NOT EXISTS market_days (
  day          bigint PRIMARY KEY,
  btc_usd      numeric(14, 2) NOT NULL,
  difficulty   numeric(24, 0) NOT NULL,
  gross_per_th numeric(12, 8) NOT NULL,
  at           bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS hash_samples (
  serial text   NOT NULL,
  at     bigint NOT NULL,
  th     numeric(12, 3) NOT NULL,
  PRIMARY KEY (serial, at)
);
CREATE INDEX IF NOT EXISTS hash_samples_at_idx ON hash_samples (at);

-- Smart Mining. kind is asic (BTC, SHA-256) or gpu_cpu. unit is what gross_per_unit is per: USD per 1 unit of hash power per day,
-- before our costs. A coin's day net profit per rig = gross per unit x rig_hash - rig_watts x 24 h x kwh_usd, the same scale for every
-- coin. All coins are measured against ONE anchor, smart_coins.ref_net (the same value on every row), which the first live reading
-- sets on a fresh database. The rig figures are editable defaults, not measurements.
CREATE TABLE IF NOT EXISTS smart_coins (
  symbol    text PRIMARY KEY,
  name      text NOT NULL,
  algo      text NOT NULL,
  kind      text NOT NULL CHECK (kind IN ('asic', 'gpu_cpu')),
  unit      text NOT NULL,
  enabled   boolean NOT NULL DEFAULT true,
  ref_gross numeric(24, 12),
  sort      integer NOT NULL DEFAULT 0,
  rig_hash  numeric(24, 6),
  rig_watts numeric(12, 2),
  kwh_usd   numeric(8, 4),
  ref_net   numeric(24, 12)
);
INSERT INTO smart_coins (symbol, name, algo, kind, unit, enabled, sort, rig_hash, rig_watts, kwh_usd) VALUES
  ('BTC', 'Bitcoin', 'SHA-256', 'asic', 'TH/s', true, 0, 200, 3500, 0.07),
  ('KAS', 'Kaspa', 'kHeavyHash', 'gpu_cpu', 'GH/s', true, 1, 40000, 3080, 0.07),
  ('RVN', 'Ravencoin', 'KawPow', 'gpu_cpu', 'MH/s', true, 2, 240, 900, 0.07),
  ('XMR', 'Monero', 'RandomX', 'gpu_cpu', 'KH/s', true, 3, 20, 150, 0.07),
  ('ETC', 'Ethereum Classic', 'Etchash', 'gpu_cpu', 'MH/s', true, 4, 500, 1100, 0.07)
ON CONFLICT (symbol) DO NOTHING;

CREATE TABLE IF NOT EXISTS coin_days (
  day            bigint NOT NULL,
  coin           text   NOT NULL REFERENCES smart_coins (symbol) ON DELETE CASCADE,
  price_usd      numeric(24, 10) NOT NULL,
  nethash        numeric(30, 0),
  block_reward   numeric(24, 10),
  block_time_s   numeric(12, 3),
  gross_per_unit numeric(24, 12) NOT NULL,
  at             bigint NOT NULL,
  net_per_rig    numeric(24, 12),
  PRIMARY KEY (day, coin)
);
CREATE INDEX IF NOT EXISTS coin_days_coin_day_idx ON coin_days (coin, day DESC);

CREATE TABLE IF NOT EXISTS smart_picks (
  day  bigint PRIMARY KEY,
  coin text   NOT NULL REFERENCES smart_coins (symbol),
  at   bigint NOT NULL
);
`,
  },
];
