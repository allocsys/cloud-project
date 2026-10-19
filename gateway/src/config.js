// Gateway settings, read from environment variables at the moment they are needed (so tests can change them).
// GATEWAY_API_SECRET  shared secret the app sends as a Bearer token
// BTC_XPUB            account-level extended PUBLIC key (xpub or zpub). Never a private key or seed.
// BTC_CONFIRMATIONS   confirmations needed before a BTC payment counts (default 1, matching the app)
// BTC_EXPLORER_URL    Esplora-compatible API base, https only (default https://mempool.space/api)
// POLL_SECONDS        how often open invoices are checked on chain (default 30, minimum 5)
// WATCHER             'off' stops this process from watching the chain (default: on when a database and BTC_XPUB are set)
// INVOICE_TTL_HOURS   how long an invoice stays open (default 72, matching the app's 3 days)
// APP_WEBHOOK_URL    where signed payment callbacks go (the app's /api/payments/webhook). https only (http only for localhost).
// GATEWAY_WEBHOOK_SECRET  signs every callback (x-gateway-sig). At least 16 characters. Same value in the app.
// OUTBOX_SECONDS      how often due callbacks are sent (default 10, minimum 1)
// RATE_SOURCE         'coingecko' (default) or 'static' (staging and tests: uses RATE_BTC_USD)
const whole = (v, dflt) => (Number(v) >= 1 ? Math.floor(Number(v)) : dflt);

export const config = () => ({
  apiSecret: process.env.GATEWAY_API_SECRET || '',
  btcXpub: (process.env.BTC_XPUB || '').trim(),
  btcConfirmations: whole(process.env.BTC_CONFIRMATIONS, 1),
  btcExplorerUrl: (process.env.BTC_EXPLORER_URL || 'https://mempool.space/api').trim(),
  pollIntervalMs: Math.max(5, whole(process.env.POLL_SECONDS, 30)) * 1000,
  watcherEnabled: process.env.WATCHER !== 'off',
  invoiceTtlMs: (Number(process.env.INVOICE_TTL_HOURS) > 0 ? Number(process.env.INVOICE_TTL_HOURS) : 72) * 3_600_000,
  appWebhookUrl: (process.env.APP_WEBHOOK_URL || '').trim(),
  webhookSecret: process.env.GATEWAY_WEBHOOK_SECRET || '',
  outboxIntervalMs: whole(process.env.OUTBOX_SECONDS, 10) * 1000,
  rateSource: process.env.RATE_SOURCE === 'static' ? 'static' : 'coingecko',
  staticBtcUsd: Number(process.env.RATE_BTC_USD) || 0,
});
