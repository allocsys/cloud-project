# Server scaffold

Route handlers in `app/api/*`, logic in `lib/server/*`. In memory for now, so data resets on deploy.

| Endpoint | What | Caching |
| --- | --- | --- |
| `GET /api/prices` | `{ prices: { btc, eth, ... }, at, source }` | Server memory 30 s (stale up to 5 min while refreshing), edge `s-maxage=15, stale-while-revalidate=60` |
| `GET /api/wallet` | `{ earned, withdrawn, history, asOf }` | `no-store`; the browser keeps a stale-while-revalidate copy (`lib/api.js`) |
| `POST /api/wallet/withdraw` | `{ asset, net, amount, address }`, `amount` in the coin. Header `Idempotency-Key` | `no-store` |

Why the app stays fast: screens render from the cached copy immediately and refresh quietly. Quote previews
are computed in the browser from the cached prices (`lib/assets.js`, shared with the server), so typing
never waits on the network. The server recomputes everything on submit and is the authority.

Prices come from CoinGecko, falling back to the static prices in `lib/assets.js`. `PRICE_FEED=static` turns the feed off.

To replace before launch:
- `lib/server/wallet.js`: the in-memory `db` (use Postgres), the accrual maths (`SATS_PER_SEC`), the single demo user (pass the signed-in user id).
- Auth on every route, and `clearApiCache()` on sign out.
- Deposit addresses (`NETWORKS` in `lib/assets.js`) and the real payout of withdrawals.
