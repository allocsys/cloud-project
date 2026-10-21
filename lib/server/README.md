# Server scaffold

Route handlers in `app/api/*`, logic in `lib/server/*`, storage in `lib/server/db.js`. Postgres is the only source of truth (`DATABASE_URL` is required). `instrumentation.js` runs the migrations in `lib/server/migrations.js` on boot, and any number of servers can run against one database. Money and miner changes go through `withUser` / `withUsers` in `db.js`, which lock the account rows in one transaction. See `DEPLOY.md`.

| Endpoint | What | Caching |
| --- | --- | --- |
| `GET /api/prices` | `{ prices: { btc, eth, ... }, at, source }` | Server memory 30 s (stale up to 5 min while refreshing), edge `s-maxage=15, stale-while-revalidate=60` |
| `GET /api/plans` | `{ halls, live, priced, smart, smartOn, smartPayout, pauseRule }`: the halls with live-linked net rates (2% below the live gross, refreshed hourly, floor 0.004; `priced` is null until the first live reading, when the saved rates apply), the live market, and Smart Mining state. A purchase reads the price once and locks it | Edge `s-maxage=10, stale-while-revalidate=30` |
| `GET /api/miners` | `{ contracts, nextSerial }` for the user | `no-store`; browser stale-while-revalidate copy |
| `GET /api/miners/:serial` | `{ contract }` or 404 | `no-store` |
| `POST /api/plans/buy` | `{ planId }`, header `Idempotency-Key`; returns the new contract and a history entry | `no-store` |
| `GET /api/wallet` | `{ earned, withdrawn, history, asOf }` | `no-store`; browser stale-while-revalidate copy |
| `POST /api/wallet/withdraw` | `{ asset, net, amount, address }`, `amount` in the coin; header `Idempotency-Key` | `no-store` |
| `GET /api/dashboard` | `{ totalTh, todayBtc, earnings, stats }` | `no-store`; browser copy |
| `GET /api/notifications` | `{ items, unread }` | `no-store`; browser copy |
| `POST /api/notifications/read` | marks everything read | `no-store` |
| `POST /api/notifications/clear` | deletes all notifications | `no-store` |
| `GET /api/referrals` | `{ code, ratePct, rules, earnedBtc, friends }` | `no-store`; browser copy |
| `GET /api/kyc` | `{ status: 'none' \| 'pending' \| 'verified', submittedAt }` | `no-store`; browser copy |
| `POST /api/kyc` | multipart: `name`, `dob` (YYYY-MM-DD), `country`, `doc`, photos `front` and `selfie` (images, max 12 MB each); header `Idempotency-Key`; 409 if already submitted | `no-store` |

Why the app stays fast: screens render from the cached copy (`lib/api.js`) immediately and refresh quietly.
Quote previews are computed in the browser from the cached prices (`lib/assets.js`, shared with the server), so typing
never waits on the network. Buying a plan and withdrawing update the screen first and roll back if the server says no.
The server recomputes everything on submit and is the authority.

Buying a plan and withdrawing also add a notification, and `totalTh` on the dashboard follows the miners you own.

Prices come from CoinGecko, falling back to the static prices in `lib/assets.js`. `PRICE_FEED=static` turns the feed off.

A plan is activated only after payment: from the balance (`payBalance`) or from a signed provider callback (`settleOrder`). An admin can change a user's balance with the `balance` action in `lib/server/admin.js`. It writes a signed entry to `u.adjust` (counted in `earnedOf`), the user's activity, the ledger and the audit log, and never edits `withdrawn` or `spent`.

To replace before launch:
- `lib/server/wallet.js`: the accrual maths (`SATS_PER_SEC`) and the payout of withdrawals.
- `lib/server/account.js`: real earnings, uptime and hashrate series, and the referral code and friends per user.
- Auth on every route. Sign out already calls `clearApiCache()`.
- Deposit addresses (`NETWORKS` in `lib/assets.js`).
- `lib/server/kyc.js`: the photos are validated and dropped. Store them in private object storage (S3 or R2), queue them for review, and set `status` to `verified` or back to `none` with a reason. Rules live in `lib/kyc.js`, shared with the form.
- Still on local data: the Earnings total mined counter, which is a simulated feed.
