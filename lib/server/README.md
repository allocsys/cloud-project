# Server scaffold

Route handlers in `app/api/*`, logic in `lib/server/*`, storage in `lib/server/db.js`. With `DATABASE_URL` set, `lib/server/persist.js` (started from `instrumentation.js`) loads the store from Postgres on boot, creates its tables, and saves changes every 2 seconds. Without it, data is in memory and resets on deploy. See `DEPLOY.md`.

| Endpoint | What | Caching |
| --- | --- | --- |
| `GET /api/prices` | `{ prices: { btc, eth, ... }, at, source }` | Server memory 30 s (stale up to 5 min while refreshing), edge `s-maxage=15, stale-while-revalidate=60` |
| `GET /api/plans` | `{ plans, halls }`, the catalogue | Edge `s-maxage=300, stale-while-revalidate=3600` |
| `GET /api/miners` | `{ contracts, nextSerial }` for the user | `no-store`; browser stale-while-revalidate copy |
| `GET /api/miners/:serial` | `{ contract }` or 404 | `no-store` |
| `POST /api/plans/buy` | `{ planId }`, header `Idempotency-Key`; returns the new contract and a history entry | `no-store` |
| `GET /api/wallet` | `{ earned, withdrawn, history, asOf }` | `no-store`; browser stale-while-revalidate copy |
| `POST /api/wallet/withdraw` | `{ asset, net, amount, address }`, `amount` in the coin; header `Idempotency-Key` | `no-store` |
| `GET /api/dashboard` | `{ totalTh, todayBtc, earnings, stats }` | `no-store`; browser copy |
| `GET /api/notifications` | `{ items, unread }` | `no-store`; browser copy |
| `POST /api/notifications/read` | marks everything read | `no-store` |
| `GET /api/referrals` | `{ code, ratePct, rules, earnedBtc, friends }` | `no-store`; browser copy |
| `GET /api/kyc` | `{ status: 'none' \| 'pending' \| 'verified', submittedAt }` | `no-store`; browser copy |
| `POST /api/kyc` | multipart: `name`, `dob` (YYYY-MM-DD), `country`, `doc`, photos `front` and `selfie` (images, max 12 MB each); header `Idempotency-Key`; 409 if already submitted | `no-store` |

Why the app stays fast: screens render from the cached copy (`lib/api.js`) immediately and refresh quietly.
Quote previews are computed in the browser from the cached prices (`lib/assets.js`, shared with the server), so typing
never waits on the network. Buying a plan and withdrawing update the screen first and roll back if the server says no.
The server recomputes everything on submit and is the authority.

Buying a plan and withdrawing also add a notification, and `totalTh` on the dashboard follows the miners you own.

Prices come from CoinGecko, falling back to the static prices in `lib/assets.js`. `PRICE_FEED=static` turns the feed off.

To replace before launch:
- `lib/server/db.js` and `persist.js`: the whole store is saved as one JSON document per user and works on a single instance. Move to real tables and per-request queries before scaling out, and pass the signed-in user id instead of the single demo user.
- `lib/server/wallet.js`: the accrual maths (`SATS_PER_SEC`) and the payout of withdrawals.
- `lib/server/miners.js`: take payment before activating a plan (see the TODO).
- `lib/server/account.js`: real earnings, uptime and hashrate series, and the referral code and friends per user.
- Auth on every route. Sign out already calls `clearApiCache()`.
- Deposit addresses (`NETWORKS` in `lib/assets.js`).
- `lib/server/kyc.js`: the photos are validated and dropped. Store them in private object storage (S3 or R2), queue them for review, and set `status` to `verified` or back to `none` with a reason. Rules live in `lib/kyc.js`, shared with the form.
- Still on local data: the Earnings total mined counter, which is a simulated feed.
