// Gateway migrations, applied in order at boot. Add new ones to the end; never edit one that has shipped.
// Amounts are stored in the chain's smallest unit (satoshi, wei, sun, nanoton, ...) as numeric(38,0), never as floats.
export const MIGRATIONS = [
  {
    id: '001_deposits',
    sql: `
-- address_counters  next xpub derivation index per network. Taken under a row lock, so two replicas never hand out the same address.
-- invoices          one deposit address per app order (kind 'order') or per wallet top-up (kind 'deposit').
-- chain_txs         every payment seen on chain for an invoice. (network, txid, vout) is unique, so a payment is counted once.
-- webhook_outbox    signed callbacks to the app, retried until delivered. One row per invoice and event.
-- audit_log         append-only record of every sensitive action.

CREATE TABLE address_counters (
  network    text PRIMARY KEY,
  next_index bigint NOT NULL DEFAULT 0
);

CREATE TABLE invoices (
  id              text PRIMARY KEY,
  ref             text NOT NULL UNIQUE,
  kind            text NOT NULL DEFAULT 'order' CHECK (kind IN ('order', 'deposit')),
  user_ref        text,
  network         text NOT NULL,
  asset           text NOT NULL,
  address         text NOT NULL,
  deriv_index     bigint NOT NULL,
  usd             numeric(14, 2),
  expected_atomic numeric(38, 0),
  received_atomic numeric(38, 0) NOT NULL DEFAULT 0,
  rate_usd        numeric(20, 8),
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirming', 'paid', 'partial', 'expired', 'failed')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  paid_at         timestamptz
);
CREATE UNIQUE INDEX invoices_address_idx ON invoices (network, address);
CREATE UNIQUE INDEX invoices_index_idx ON invoices (network, deriv_index);
CREATE INDEX invoices_open_idx ON invoices (status) WHERE status IN ('pending', 'confirming', 'partial');

CREATE TABLE chain_txs (
  id            bigserial PRIMARY KEY,
  invoice_id    text NOT NULL REFERENCES invoices (id),
  network       text NOT NULL,
  txid          text NOT NULL,
  vout          integer NOT NULL DEFAULT 0,
  amount_atomic numeric(38, 0) NOT NULL CHECK (amount_atomic > 0),
  confirmations integer NOT NULL DEFAULT 0,
  block_height  bigint,
  seen_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (network, txid, vout)
);
CREATE INDEX chain_txs_invoice_idx ON chain_txs (invoice_id);

CREATE TABLE webhook_outbox (
  id           bigserial PRIMARY KEY,
  invoice_id   text NOT NULL REFERENCES invoices (id),
  event        text NOT NULL,
  payload      jsonb NOT NULL,
  attempts     integer NOT NULL DEFAULT 0,
  next_try_at  timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  last_error   text,
  UNIQUE (invoice_id, event)
);
CREATE INDEX webhook_outbox_due_idx ON webhook_outbox (next_try_at) WHERE delivered_at IS NULL;

CREATE TABLE audit_log (
  id      bigserial PRIMARY KEY,
  at      timestamptz NOT NULL DEFAULT now(),
  actor   text NOT NULL,
  action  text NOT NULL,
  subject text,
  detail  jsonb
);

CREATE FUNCTION audit_log_readonly() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_log_no_change BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_readonly();
`,
  },
  {
    id: '002_shared_addresses',
    sql: `
-- Fixed-address mode: many invoices pay ONE address and are told apart by their exact amount (match_amount = true).
-- invoices_amount_open_idx  two open invoices on the same address and asset can never expect the same amount.
-- unmatched_txs             payments to a shared address that match no open invoice (wrong amount, late). Kept for a person to resolve.
ALTER TABLE invoices ADD COLUMN match_amount boolean NOT NULL DEFAULT false;
DROP INDEX IF EXISTS invoices_address_idx;
CREATE INDEX invoices_address_idx ON invoices (network, address);
CREATE UNIQUE INDEX invoices_amount_open_idx ON invoices (network, asset, address, expected_atomic)
  WHERE match_amount AND status IN ('pending', 'confirming', 'partial');

CREATE TABLE unmatched_txs (
  id            bigserial PRIMARY KEY,
  network       text NOT NULL,
  asset         text NOT NULL,
  address       text NOT NULL,
  txid          text NOT NULL,
  vout          integer NOT NULL DEFAULT 0,
  amount_atomic numeric(38, 0) NOT NULL CHECK (amount_atomic > 0),
  confirmations integer NOT NULL DEFAULT 0,
  seen_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (network, txid, vout)
);
`,
  },
  {
    id: '003_address_unique_unless_shared',
    sql: `
-- A per-invoice address (extended key) is still never reused. Only fixed-address invoices (match_amount) may share one.
DROP INDEX IF EXISTS invoices_address_idx;
CREATE UNIQUE INDEX invoices_address_idx ON invoices (network, address) WHERE NOT match_amount;
CREATE INDEX invoices_shared_address_idx ON invoices (network, address) WHERE match_amount;
`,
  },
  {
    id: '004_chain_scanner',
    sql: `
-- chain_cursors  where the block scanner of each network stopped: the last block read, its hash (to spot a reorg) and the chain tip then.
-- observed_txs   every payment the scanner saw to our receiving address. (network, txid, vout) is unique; vout is 0 for a native
--                transfer and the log index + 1 for a token transfer. Dropped again when a reorg removes its block.
CREATE TABLE chain_cursors (
  network    text PRIMARY KEY,
  height     bigint NOT NULL,
  hash       text NOT NULL,
  tip        bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE observed_txs (
  id            bigserial PRIMARY KEY,
  network       text NOT NULL,
  txid          text NOT NULL,
  vout          integer NOT NULL DEFAULT 0,
  address       text NOT NULL,
  asset         text NOT NULL,
  amount_atomic numeric(38, 0) NOT NULL CHECK (amount_atomic > 0),
  block_height  bigint NOT NULL,
  seen_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (network, txid, vout)
);
CREATE INDEX observed_txs_address_idx ON observed_txs (network, address, block_height);
`,
  },
  {
    id: '005_unmatched_handled',
    sql: `
-- A person returns an unmatched payment by hand and marks it handled. The row stays (history); the overview then hides it.
-- recordUnmatched() only ever updates confirmations on a conflict, so a handled row is never re-opened.
ALTER TABLE unmatched_txs ADD COLUMN handled_at timestamptz, ADD COLUMN handled_note text;
`,
  },
];
