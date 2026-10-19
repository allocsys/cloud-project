# Moving hosts

The app ships as a Docker image, so any host that runs containers can run it (Railway, Fly.io, Render, a VPS, Cloud Run).

## Anywhere with Docker (app and Postgres together)

```
docker compose up --build
```

This starts the app on port 3000 and a Postgres database with a persistent volume. Tables are created on first boot.
Set `POSTGRES_PASSWORD` in the environment for anything beyond local testing.

## Any host with its own Postgres

Set one variable on the app and nothing else:

```
DATABASE_URL=postgres://user:password@host:5432/dbname
```

The app creates and updates its tables on boot (numbered migrations, safe when several servers start at once). `DATABASE_URL` is required: without it the app cannot serve accounts and `/api/health` answers 503.

## Moving existing data

```
pg_dump "$OLD_DATABASE_URL" | psql "$NEW_DATABASE_URL"
```

Then point `DATABASE_URL` at the new database and redeploy.

## Notes

- **Check:** `GET /api/health` returns `{ ok: true, store: "postgres" }` when the database answers, and 503 when it does not.
- **Admin:** open `/admin`. It stays off until `ADMIN_TOKEN` (12 or more characters, keep it secret) is set; you sign in with that token. Five wrong tries lock an address for 15 minutes.
- **Paying for plans:** a plan is paid from the user's balance, or by crypto invoice once NOWPayments is set up. Set `NOWPAYMENTS_API_KEY` and `NOWPAYMENTS_IPN_SECRET` (Store settings > IPN secret). In the NOWPayments dashboard the callback is sent to `<APP_URL>/api/payments/webhook`; set `APP_URL` to the public address. Use `NOWPAYMENTS_API_URL=https://api-sandbox.nowpayments.io/v1` with sandbox keys to test. The miner starts only after a signed `finished` callback for the full amount. Without the two keys, crypto is off and only balance payments work. The demo account is not charged.
- **Port:** reads `PORT` (default 3000). **Env:** `PRICE_FEED=static` turns off the CoinGecko feed.
- **HTTPS:** put the container behind a proxy or the host's TLS. The PWA install and the service worker need HTTPS.
- **Build needs internet.** `next/font` downloads Roboto during `npm run build`. If Google Fonts is briefly unreachable the build fails with a `next/font` error; the host keeps serving the previous version, so just redeploy.
- **Several servers:** run as many app instances as you like against the same `DATABASE_URL` (Railway replicas, or containers behind a load balancer). All state is in Postgres: balances and purchases run in row-locked transactions, serial numbers, idempotency keys and sign-in throttling are shared. Set `SESSION_SECRET` (32+ random characters) so every server signs sessions with the same key; if unset, a key stored in the database is used. `PG_POOL_MAX` (default 10) is the connections each instance may hold; keep instances x `PG_POOL_MAX` below the database's `max_connections`. Price cache and rate limits are per server, which is fine. Postgres is the single point of failure: take regular backups off the server (`pg_dump`).
- **Railway:** unchanged. It builds with `npm run build` and starts with `next start`.
