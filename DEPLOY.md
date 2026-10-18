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

The app creates its tables on boot. Without `DATABASE_URL` it runs in memory and data resets on restart.

## Moving existing data

```
pg_dump "$OLD_DATABASE_URL" | psql "$NEW_DATABASE_URL"
```

Then point `DATABASE_URL` at the new database and redeploy.

## Notes

- **Check:** `GET /api/health` returns `{ ok: true, store: "postgres" }` when the database is connected. `memory` means it is not.
- **Admin:** open `/admin`. It stays off until `ADMIN_TOKEN` (12 or more characters, keep it secret) is set; you sign in with that token. Five wrong tries lock an address for 15 minutes.
- **Paying for plans:** a plan is paid from the user's balance, or by crypto invoice once NOWPayments is set up. Set `NOWPAYMENTS_API_KEY` and `NOWPAYMENTS_IPN_SECRET` (Store settings > IPN secret). In the NOWPayments dashboard the callback is sent to `<APP_URL>/api/payments/webhook`; set `APP_URL` to the public address. Use `NOWPAYMENTS_API_URL=https://api-sandbox.nowpayments.io/v1` with sandbox keys to test. The miner starts only after a signed `finished` callback for the full amount. Without the two keys, crypto is off and only balance payments work. The demo account is not charged.
- **Port:** reads `PORT` (default 3000). **Env:** `PRICE_FEED=static` turns off the CoinGecko feed.
- **HTTPS:** put the container behind a proxy or the host's TLS. The PWA install and the service worker need HTTPS.
- **Build needs internet.** `next/font` downloads Roboto during `npm run build`. If Google Fonts is briefly unreachable the build fails with a `next/font` error; the host keeps serving the previous version, so just redeploy.
- **One instance only.** Each instance keeps its own working copy and saves every 2 seconds, so a crash can lose the last couple of seconds. Move to per-request queries before scaling out.
- **Railway:** unchanged. It builds with `npm run build` and starts with `next start`.
