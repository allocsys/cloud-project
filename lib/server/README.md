# Server scaffold

Route handlers in `app/api/*`, logic in `lib/server/*`, storage in `lib/server/db.js`. In memory for now, so data resets on deploy.

| Endpoint | What | Caching |
| --- | --- | --- |
| `GET /api/prices` | `{ prices: { btc, eth, ... }, at, source }` | Server memory 30 s (stale up to 5 min while refreshing), edge `s-maxage=15, stale-while-revalidate=60` |
| `GET /api/plans` | `{ plans, halls }`, the catalogue | Edge `s-maxage=300, stale-while-revalidate=3600` |
| `GET /api/miners` | `{ contracts, nextSerial }` for the user | `no-store`; browser stale-while-revalidate copy |
| `GET /api/miners/:serial` | `{ contract }` or 404 | `no-store` |
| `POST /api/plans/buy` | `{ planId }`, header `Idempotency-Key`; returns the new contract and a history entry | `no-store` |
| `GET /api/wallet` | `{ earned, withdrawn, history, asOf }` | `no-store`; browser stale-while-revalidate copy |
| `POST /api/wallet/withdraw` | `{ asset, net, amount, address }`, `amount` in the coin; header `Idempotency-Key` | `no-store` |

Why the app stays fast: screens render from the cached copy (`lib/api.js`) immediately and refresh quietly.
Quote previews are computed in the browser from the cached prices (`lib/assets.js`, shared with the server), so typing
never waits on the network. Buying a plan and withdrawing update the screen first and roll back if the server says no.
The server recomputes everything on submit and is the authority.

Prices come from CoinGecko, falling back to the static prices in `lib/assets.js`. `PRICE_FEED=static` turns the feed off.

To replace before launch:
- `lib/server/db.js`: the in-memory store (use Postgres) and the single demo user (pass the signed-in user id).
- `lib/server/wallet.js`: the accrual maths (`SATS_PER_SEC`) and the payout of withdrawals.
- `lib/server/miners.js`: take payment before activating a plan (see the TODO).
- Auth on every route. Sign out already calls `clearApiCache()`.
- Deposit addresses (`NETWORKS` in `lib/assets.js`).
- Still on local data: dashboard, notifications, referrals and KYC (`lib/data.js`).
