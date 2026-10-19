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
| `BTC_CONFIRMATIONS` | confirmations before a BTC payment counts (default 1) |
| `BTC_EXPLORER_URL` | Esplora-compatible API, https only (default `https://mempool.space/api`) |
| `POLL_SECONDS` | how often open invoices are checked on chain (default 30, minimum 5) |
| `WATCHER` | `off` stops this process from watching the chain |
| `APP_WEBHOOK_URL` | the app's `/api/payments/webhook`. https only (http only for localhost) |
| `GATEWAY_WEBHOOK_SECRET` | signs every callback, at least 16 characters, same value in the app |
| `OUTBOX_SECONDS` | how often due callbacks are sent (default 10, minimum 1) |
| `INVOICE_TTL_HOURS` | how long an invoice stays open (default 72) |
| `RATE_SOURCE` | `coingecko` (default) or `static` (staging only, uses `RATE_BTC_USD`) |
| `PGSSL` | `1` to use TLS to Postgres |

## API (all under `/v1`, Bearer secret required)
- `POST /v1/invoices` body `{ ref, usd, network: "btc", asset: "btc", kind?: "order"|"deposit", user_ref? }`. Returns `201` with the invoice, or `200` with the same invoice if `ref` was already used (`409` if it was used with different details). An order needs `usd`; a wallet top-up (`kind: "deposit"`) needs `user_ref` and no amount. No fresh rate means `503`, never a guessed price.
- `GET /v1/invoices/:ref` returns the invoice.

## Webhook to the app (the only link between the two)
When an order invoice is settled the gateway queues one callback per invoice and event (`finished`, `partially_paid` or `expired`) and sends it with `POST APP_WEBHOOK_URL`.

Body (JSON), the shape the app's `settleOrder` expects:
```
{ order_id, payment_id, payment_status, price_amount, price_currency: "usd", pay_currency, network, pay_amount, actually_paid }
```
Headers: `x-gateway-sig` (hex HMAC-SHA512, see below), `x-gateway-event` (event name), `x-gateway-delivery` (outbox row id, for logs).

Signature: take the JSON body, sort the keys of every object recursively, serialise with `JSON.stringify`, and compute HMAC-SHA512 with `GATEWAY_WEBHOOK_SECRET`, as lowercase hex. The app does the same and compares in constant time (`verifyGatewaySig` in `lib/server/pay-provider.js`). A bad signature gets `401`.

Delivery rules:
- At least once. The app activates an order once however often it is told, so a repeat is harmless.
- Success is any `2xx`. Anything else (or a network error, or no answer in 10 s) is a failure: the error is stored and the next try is 30 s, 1 min, 2 min ... up to 1 hour later.
- After 24 failed attempts the callback is parked (never dropped): it stays undelivered with `last_error`, and an audit entry `webhook.gave_up` is written. A person resolves it.
- Redirects are refused. The secret and the body are never logged.
- Several replicas are safe: a due row is claimed with `FOR UPDATE SKIP LOCKED` and a 60 s lease before it is sent.

## Status
- Done: skeleton, health, migrations, schema 001, BTC address derivation, deposit API, settlement rules, chain watcher, signed webhook sender.
- Next: Railway service and database, then wallet top-ups (`kind: "deposit"`), withdrawals, other networks, swaps.
- No lockfile yet: run `npm install` in `gateway/` once and commit `package-lock.json`, then switch the Dockerfile to `npm ci`.
