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
    id: '007_smart_mining',
    sql: `
-- Smart Mining: the coins it can pick from (admin edits this list, no deploy needed), one market row per coin and UTC day,
-- and the coin picked for each day. kind is asic (BTC, SHA-256) or gpu_cpu. unit is what gross_per_unit is per:
-- USD per 1 unit of hash power per day, before our costs. Today's coin_days rows follow the live feed and are rewritten
-- every few minutes; once the day is over nothing writes to them again. smart_picks is written once per day and then
-- locked, so a paid day never changes. ref_gross is the coin's gross per unit when Smart Mining was priced; a day's market
-- is measured against it, so every coin keeps the same margin (null until the first snapshot sets it).
-- day is the UTC midnight in milliseconds.
CREATE TABLE IF NOT EXISTS smart_coins (
  symbol  text PRIMARY KEY,
  name    text NOT NULL,
  algo    text NOT NULL,
  kind    text NOT NULL CHECK (kind IN ('asic', 'gpu_cpu')),
  unit    text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  ref_gross numeric(24, 12),
  sort    integer NOT NULL DEFAULT 0
);
INSERT INTO smart_coins (symbol, name, algo, kind, unit, enabled, sort) VALUES
  ('BTC', 'Bitcoin', 'SHA-256', 'asic', 'TH/s', true, 0),
  ('KAS', 'Kaspa', 'kHeavyHash', 'gpu_cpu', 'GH/s', true, 1),
  ('RVN', 'Ravencoin', 'KawPow', 'gpu_cpu', 'MH/s', true, 2),
  ('XMR', 'Monero', 'RandomX', 'gpu_cpu', 'KH/s', true, 3)
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
  PRIMARY KEY (day, coin)
);
CREATE TABLE IF NOT EXISTS smart_picks (
  day  bigint PRIMARY KEY,
  coin text   NOT NULL REFERENCES smart_coins (symbol),
  at   bigint NOT NULL
);
`,
  },
  {
    id: '008_coin_days_nullable',
    sql: `
-- 007 first shipped with these three columns NOT NULL. BTC has no network figures of its own (its market comes from the
-- fixed-plan feed), so its snapshot row failed with a null value. Make them optional on databases that already ran 007.
-- Nothing happens on a database where they are already optional.
ALTER TABLE coin_days ALTER COLUMN nethash DROP NOT NULL;
ALTER TABLE coin_days ALTER COLUMN block_reward DROP NOT NULL;
ALTER TABLE coin_days ALTER COLUMN block_time_s DROP NOT NULL;
`,
  },
  {
    id: '009_no_fixed_plans',
    sql: `
-- The six fixed plans are gone: ASICs power is priced from the halls alone. Remove the plans from a saved (admin-edited)
-- catalogue, keeping its halls. Nothing happens when no catalogue was saved.
UPDATE meta SET data = data - 'plans', updated_at = now() WHERE key = 'catalog' AND data ? 'plans';
`,
  },
  {
    id: '010_coin_net_profit',
    sql: `
-- Smart Mining now follows real profitability: every coin has a reference rig (rig_hash in the coin's own unit, rig_watts of power)
-- and an electricity price (kwh_usd). A day's net profit per rig = gross per unit x rig_hash - rig_watts x 24 h x kwh_usd, in USD,
-- the same scale for every coin. coin_days.net_per_rig keeps it for each day (finished days are never rewritten). All coins are
-- measured against ONE anchor, smart_coins.ref_net (the same value on every row): the best net profit of the latest day with data,
-- or the first reading after this migration on a fresh database. The rig figures below are editable defaults, not measurements.
ALTER TABLE smart_coins ADD COLUMN IF NOT EXISTS rig_hash  numeric(24, 6);
ALTER TABLE smart_coins ADD COLUMN IF NOT EXISTS rig_watts numeric(12, 2);
ALTER TABLE smart_coins ADD COLUMN IF NOT EXISTS kwh_usd   numeric(8, 4);
ALTER TABLE smart_coins ADD COLUMN IF NOT EXISTS ref_net   numeric(24, 12);
ALTER TABLE coin_days   ADD COLUMN IF NOT EXISTS net_per_rig numeric(24, 12);
UPDATE smart_coins SET
  rig_hash  = CASE symbol WHEN 'BTC' THEN 200 WHEN 'KAS' THEN 21000 WHEN 'RVN' THEN 240 WHEN 'XMR' THEN 20 END,
  rig_watts = CASE symbol WHEN 'BTC' THEN 3500 WHEN 'KAS' THEN 3150 WHEN 'RVN' THEN 900 WHEN 'XMR' THEN 150 END,
  kwh_usd   = 0.07
WHERE symbol IN ('BTC', 'KAS', 'RVN', 'XMR') AND rig_hash IS NULL;
UPDATE coin_days d SET net_per_rig = d.gross_per_unit * c.rig_hash - c.rig_watts * 24 / 1000 * c.kwh_usd
FROM smart_coins c WHERE c.symbol = d.coin AND d.net_per_rig IS NULL AND c.rig_hash IS NOT NULL;
UPDATE smart_coins SET ref_net = (
  SELECT max(net_per_rig) FROM coin_days WHERE net_per_rig > 0 AND day = (SELECT max(day) FROM coin_days WHERE net_per_rig > 0)
) WHERE ref_net IS NULL;
`,
  },
];
