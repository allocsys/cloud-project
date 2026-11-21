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

## Web and API as two services

One repo, one Dockerfile, two services. `APP_ROLE` picks what a service builds and runs (set it before the build):

- **unset or `all`:** pages and API in one server. This is also the rollback.
- **`web`:** pages only. The API code is removed at build, so it needs no database and no secrets. Health path `/healthz`. Reads site data from the API through `API_URL` with `API_SVC_SECRET`.
- **`api`:** API only. The pages are removed at build. Runs migrations and the tickers, and holds the secrets. Health path `/api/health`.

A Cloudflare Worker sends `/api/*` to the API (`API_ORIGIN`) and everything else to web. It adds `x-vtx-edge` (`API_EDGE_SECRET`) and `x-vtx-ip`. When `API_EDGE_SECRET` is set on the API, `/api/*` without the edge header is refused. Health checks, the payment webhook, telemetry and bot calls are exempt.

Variables:

- **web:** `APP_ROLE=web`, `HEALTH_PATH=/healthz`, `API_URL`, `API_SVC_SECRET`, `APP_URL`.
- **api:** `APP_ROLE=api`, `HEALTH_PATH=/api/health`, `API_EDGE_SECRET`, `API_SVC_SECRET`, plus everything in the notes below (database, session, payments, gateway, bot, mail).
- **Gateway and bot:** point to the API's private address, not to web: the gateway with `APP_WEBHOOK_URL`, the bot with `APP_API_URL` (e.g. `http://api.railway.internal:8080`). The bot's `APP_URL` stays the public https address (`https://vertexhash.com`): it goes into buttons people see, and Telegram refuses a non-https web app button.

Tickers must run on one service only: the API. Never run a second `all` service next to it.

Watch patterns (Railway redeploys a service only when these files change):

- **web:** `app/(app)`, `app/(plain)`, `app/(site)`, `app/status`, `app/healthz`, `app/icons`, `app/*.js`, `app/*.css`, `components`, `public`, shared `lib/*.js` and `lib/i18n`, `middleware.js`, `instrumentation.js`, build files.
- **api:** `app/api`, `lib/server`, shared `lib/*.js` and `lib/i18n`, `middleware.js`, `instrumentation.js`, build files.
- Build files: `next.config.mjs`, `jsconfig.json`, `package.json`, `package-lock.json`, `Dockerfile`, `scripts`.
- If a push is skipped by mistake, redeploy by hand.

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
