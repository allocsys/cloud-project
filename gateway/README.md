# Opus gateway

Separate payment service (deposits, withdrawals, swaps). Lives in this repo for now; it can be split out later with `git subtree split --prefix=gateway`.

## Separation rules
- Never import from `app/`, `lib/` or `components/`. The app never imports from `gateway/`.
- Own Postgres, own env vars, own Railway service (Root Directory `gateway`, Watch Paths `/gateway/**`).
- The only link to the app is a signed webhook (HMAC) carrying the payload `settleOrder` expects.
- Config only through environment variables. No platform-specific code.

## Run
```
cd gateway && npm start      # http://localhost:4000/health
```

## Status
Skeleton only: `/health`. Next: database and migrations, then deposits.
