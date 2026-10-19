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
The gateway only ever holds PUBLIC keys. Deposit addresses come from an extended public key (xpub or zpub) given in an env var; private keys and seed phrases never go in this service or its variables.

## Status
- Done: skeleton, `/health` (with DB check), migrations runner, schema 001, BTC address derivation (`src/chains/btc.js`, BIP84 test vector).
- Next: deposit API (create invoice, status), chain watcher, signed webhook sender.
- No lockfile yet: run `npm install` in `gateway/` once and commit `package-lock.json`, then switch the Dockerfile to `npm ci`.
