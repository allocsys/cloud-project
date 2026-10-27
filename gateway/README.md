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
The gateway only ever holds PUBLIC keys and addresses. Private keys and seed phrases never go in this service or its variables.

## Two ways to receive
- **Fixed address** (what staging uses): every invoice on a network pays the same public address (`PAY_ADDR_*`). The invoice is told apart by a unique exact amount, so the buyer must send exactly that amount. A payment with another amount, coin or network is kept aside as unmatched for a person to resolve (admin Gateway tab). A wallet that deducts its fee from the amount sent will land there too.
- **Own address per invoice** (BTC only): an extended public key (xpub or zpub) in `BTC_XPUB` gives each invoice a fresh address. Used when `BTC_XPUB` is set.

## Networks and coins
| Network | Coins | Detection |
| --- | --- | --- |
| `btc` | BTC | Esplora explorer, per invoice |
| `eth`, `bsc`, `pol` | native coin (ETH, BNB, POL), USDT, USDC | own block scanner (`evm-scanner.js`), stored in `observed_txs`, reorg safe |
| `trx` | TRX, USDT (TRC20) | TronGrid HTTP API (`tron-explorer.js`) |
| `sol` | SOL, USDT, USDC (SPL) | Solana JSON-RPC (`sol-explorer.js`) |
| `ton` | TON | toncenter v3 HTTP API (`ton-explorer.js`); plain TON transfers only, no jettons (USDT on TON) |

A network is only offered when its address is set (and, for EVM, listed in `EVM_NETWORKS`). Only plain transfers to the address are seen on EVM chains; transfers made inside a contract call (internal transfers) are not. Token contracts and mints are in `src/chains/`: verify USDT on tether.to/en/supported-protocols before going live.

## Environment
| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | the gateway's own Postgres |
| `GATEWAY_API_SECRET` | shared secret the app sends as `Authorization: Bearer ...` |
| `BTC_XPUB` | account-level extended public key (xpub or zpub); a fresh BTC address per invoice |
| `PAY_ADDR_BTC` | fixed-address mode: one public BTC address (used when `BTC_XPUB` is not set) |
| `PAY_ADDR_EVM` | one public address for Ethereum, BNB Chain and Polygon |
| `PAY_ADDR_TRX`, `PAY_ADDR_SOL`, `PAY_ADDR_TON` | public receiving address on Tron, on Solana, on TON (friendly `UQ...`/`EQ...` or raw `0:...`, main network only) |
| `EVM_NETWORKS` | which EVM networks to accept, comma separated (default `eth,bsc,pol`) |
| `EVM_RPC_ETH`, `EVM_RPC_BSC`, `EVM_RPC_POL` | JSON-RPC endpoints, comma separated, https only, tried in order (public nodes by default) |
| `EVM_CONF_ETH`, `EVM_CONF_BSC`, `EVM_CONF_POL` | confirmations before an EVM payment counts (defaults 12, 15, 64) |
| `EVM_SCAN_SECONDS` | how often each EVM chain is scanned (default 15, minimum 3) |
| `TRON_API_URL`, `TRON_API_KEY` | TronGrid-compatible API (default `https://api.trongrid.io`), optional key |
| `TRX_CONFIRMATIONS` | confirmations for a Tron payment (default 1) |
| `SOL_RPC` | Solana JSON-RPC endpoints, comma separated, https only (public nodes by default; may carry a provider key) |
| `SOL_CONFIRMATIONS` | confirmations for a Solana payment (default 1; only finalized payments count) |
| `TON_API_URL`, `TON_API_KEY` | toncenter-compatible v3 API (default `https://toncenter.com`), optional key (header `X-API-Key`; without one the limit is 1 request per second) |
| `TON_CONFIRMATIONS` | confirmations for a TON payment (default 1; a payment in a masterchain block, or older than 30 s, shows 1) |
| `BTC_CONFIRMATIONS` | confirmations before a BTC payment counts (default 1) |
| `BTC_EXPLORER_URL` | Esplora-compatible API, https only (default `https://mempool.space/api`) |
| `POLL_SECONDS` | how often open invoices are checked on chain (default 30, minimum 5) |
| `WATCHER` | `off` stops this process from watching the chain |
| `APP_WEBHOOK_URL` | the app's `/api/payments/webhook`. https only (http only for localhost) |
| `GATEWAY_WEBHOOK_SECRET` | signs every callback, at least 16 characters, same value in the app |
| `OUTBOX_SECONDS` | how often due callbacks are sent (default 10, minimum 1) |
| `INVOICE_TTL_MINUTES` | how long an invoice stays open before it expires (default 10) |
| `INVOICE_BUFFER_PERCENT` | extra added to every invoice amount for fees, commissions and price moves (default 2, from 0 to 20) |
| `EVM_CATCHUP_HOURS` | an idle EVM scanner wakes when an invoice opens and reads back at most this many hours (default 6) |
| `IDLE_POLL_SECONDS` | how often the watcher looks for new invoices while none is open (default 60) |
| `RATE_SOURCE` | `coingecko` (default) or `static` (staging only, uses `RATE_BTC_USD`) |
| `PGSSL` | `1` to use TLS to Postgres |

## API (all under `/v1`, Bearer secret required)
- `POST /v1/invoices` body `{ ref, usd, network: "btc"|"eth"|"bsc"|"pol"|"trx"|"sol"|"ton", asset, kind?: "order"|"deposit", user_ref? }` (network and asset default to `btc`; an unknown pair is `400`, a network that is not set up is `503`). The invoice carries `address`, `amount` (the exact amount to send), `uri` and `expires_at`. Returns `201` with the invoice, or `200` with the same invoice if `ref` was already used (`409` if it was used with different details). An order needs `usd`; a wallet top-up (`kind: "deposit"`) needs `user_ref` and no amount. No fresh rate means `503`, never a guessed price.
- `GET /v1/invoices/:ref` returns the invoice.
- `GET /v1/admin/overview` status for the app's admin Gateway tab: networks and scanners (cursor height, tip, age), invoices by status and recent, unmatched payments (handled ones are hidden), callbacks and the audit log.
- `POST /v1/admin/unmatched/handle` body `{ network, txid, vout, note? }` marks an unmatched payment as handled after a person returned the money by hand (the gateway holds no keys and sends nothing). `note` is at most 80 characters. Writes an `unmatched.handled` audit row. Repeating it is fine (`already: true`); an unknown payment is `404`. The scanner never re-opens a handled row.

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
- Done: skeleton, health, migrations, BTC, fixed-address mode, EVM scanner, Tron, Solana, deposit API, settlement rules, chain watcher, signed webhook sender, admin overview, Railway service and database.
- Next: live tests with small amounts on each network, then withdrawals and swaps.
- No lockfile yet: run `npm install` in `gateway/` once and commit `package-lock.json`, then switch the Dockerfile to `npm ci`.
