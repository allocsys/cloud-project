// Gateway settings, read from environment variables at the moment they are needed (so tests can change them).
// GATEWAY_DB_NAME     optional. Shared Postgres server: DATABASE_URL points at the server, the gateway creates and uses its own database with this name (read in server.js)
// GATEWAY_DB_USER, GATEWAY_DB_PASSWORD  optional, one-time: with the admin DATABASE_URL, creates a limited login (owns only the gateway database, 16+ char password). Then set DATABASE_URL to that login and remove these three variables.
// GATEWAY_API_SECRET  shared secret the app sends as a Bearer token
// BTC_XPUB            account-level extended PUBLIC key (xpub or zpub). Never a private key or seed. A fresh address per invoice.
// PAY_ADDR_BTC        fixed-address mode: one public BTC address; invoices are told apart by exact amount. Used when BTC_XPUB is not set.
// PAY_ADDR_EVM, PAY_ADDR_TRX, PAY_ADDR_SOL  public receiving addresses (EVM chains share one) for the fixed-address networks.
// BTC_CONFIRMATIONS   confirmations needed before a BTC payment counts (default 1, matching the app)
// BTC_EXPLORER_URL    Esplora-compatible API base, https only (default https://mempool.space/api)
// POLL_SECONDS        how often open invoices are checked on chain (default 30, minimum 5)
// WATCHER             'off' stops this process from watching the chain (default: on when a database and a BTC key or address are set)
// INVOICE_TTL_HOURS   how long an invoice stays open (default 72, matching the app's 3 days)
// APP_WEBHOOK_URL    where signed payment callbacks go (the app's /api/payments/webhook). https only (http only for localhost).
// GATEWAY_WEBHOOK_SECRET  signs every callback (x-gateway-sig). At least 16 characters. Same value in the app.
// OUTBOX_SECONDS      how often due callbacks are sent (default 10, minimum 1)
// RATE_SOURCE         'coingecko' (default) or 'static' (staging and tests: uses RATE_BTC_USD, or RATE_<ASSET>_USD)
const whole = (v, dflt) => (Number(v) >= 1 ? Math.floor(Number(v)) : dflt);
const text = (v) => String(v || '').trim();

export const config = () => ({
  apiSecret: process.env.GATEWAY_API_SECRET || '',
  btcXpub: text(process.env.BTC_XPUB),
  btcConfirmations: whole(process.env.BTC_CONFIRMATIONS, 1),
  btcExplorerUrl: text(process.env.BTC_EXPLORER_URL) || 'https://mempool.space/api',
  payAddr: {
    btc: text(process.env.PAY_ADDR_BTC),
    evm: text(process.env.PAY_ADDR_EVM),
    trx: text(process.env.PAY_ADDR_TRX),
    sol: text(process.env.PAY_ADDR_SOL),
  },
  pollIntervalMs: Math.max(5, whole(process.env.POLL_SECONDS, 30)) * 1000,
  watcherEnabled: process.env.WATCHER !== 'off',
  invoiceTtlMs: (Number(process.env.INVOICE_TTL_HOURS) > 0 ? Number(process.env.INVOICE_TTL_HOURS) : 72) * 3_600_000,
  appWebhookUrl: text(process.env.APP_WEBHOOK_URL),
  webhookSecret: process.env.GATEWAY_WEBHOOK_SECRET || '',
  outboxIntervalMs: whole(process.env.OUTBOX_SECONDS, 10) * 1000,
  rateSource: process.env.RATE_SOURCE === 'static' ? 'static' : 'coingecko',
  staticBtcUsd: Number(process.env.RATE_BTC_USD) || 0,
});
