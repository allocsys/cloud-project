// Gateway settings, read from environment variables at the moment they are needed (so tests can change them).
// GATEWAY_API_SECRET  shared secret the app sends as a Bearer token
// BTC_XPUB            account-level extended PUBLIC key (xpub or zpub). Never a private key or seed.
// BTC_CONFIRMATIONS   confirmations needed before a BTC payment counts (default 1, matching the app)
// INVOICE_TTL_HOURS   how long an invoice stays open (default 72, matching the app's 3 days)
// RATE_SOURCE         'coingecko' (default) or 'static' (staging and tests: uses RATE_BTC_USD)
const whole = (v, dflt) => (Number(v) >= 1 ? Math.floor(Number(v)) : dflt);

export const config = () => ({
  apiSecret: process.env.GATEWAY_API_SECRET || '',
  btcXpub: (process.env.BTC_XPUB || '').trim(),
  btcConfirmations: whole(process.env.BTC_CONFIRMATIONS, 1),
  invoiceTtlMs: (Number(process.env.INVOICE_TTL_HOURS) > 0 ? Number(process.env.INVOICE_TTL_HOURS) : 72) * 3_600_000,
  rateSource: process.env.RATE_SOURCE === 'static' ? 'static' : 'coingecko',
  staticBtcUsd: Number(process.env.RATE_BTC_USD) || 0,
});
