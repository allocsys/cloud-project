# Opus gateway

Separate payment service (deposits, withdrawals, swaps). Lives in this repo for now; it can be split out later with `git subtree split --prefix=gateway`.

## Separation rules
- Never import from `app/`, `lib/` or `components/`. The app never imports from `gateway/`.
- Own Postgres (`DATABASE_URL`), own env vars, own Railway service (Root Directory `gateway`, Watch Paths `/gateway/**`).
- The only link to the app is a signed webhook (HMAC) carrying the payload `settleOrder` expects.
- Config only through environment variables. No platform-specific code.

## Run
```
cd gateway && npm install && npm start      # http://localhost:4000/health
```
With `DATABASE_URL` set, migrations run at boot (advisory-locked, safe with several replicas).

## Keys
The gateway only ever holds PUBLIC keys. Deposit addresses come from an extended public key (xpub or zpub) given in `BTC_XPUB`; private keys and seed phrases never go in this service or its variables.

## Environment
| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | the gateway's own Postgres |
| `GATEWAY_API_SECRET` | shared secret the app sends as `Authorization: Bearer ...` |
| `BTC_XPUB` | account-level extended public key (xpub or zpub) |
| `INVOICE_TTL_HOURS` | how long an invoice stays open (default 72) |
| `RATE_SOURCE` | `coingecko` (default) or `static` (staging only, uses `RATE_BTC_USD`) |
| `PGSSL` | `1` to use TLS to Postgres |

## API (all under `/v1`, Bearer secret required)
- `POST /v1/invoices` body `{ ref, usd, network: "btc", asset: "btc", kind?: "order"|"deposit", user_ref? }`. Returns `201` with the invoice, or `200` with the same invoice if `ref` was already used (`409` if it was used with different details). An order needs `usd`; a wallet top-up (`kind: "deposit"`) needs `user_ref` and no amount. No fresh rate means `503`, never a guessed price.
- `GET /v1/invoices/:ref` returns the invoice.

## Status
- Done: skeleton, health, migrations, schema 001, BTC address derivation, deposit API.
- Next: chain watcher (confirmations, partial and late payments, expiry) and the signed webhook sender.
- No lockfile yet: run `npm install` in `gateway/` once and commit `package-lock.json`, then switch the Dockerfile to `npm ci`.
