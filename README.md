# Opus Cloud Mining

Front end for a cloud mining app. Black and gold, responsive (bottom tabs on mobile, sidebar on desktop). Built with Next.js App Router.

## Run

```bash
npm install
npm run dev
```

## Screens

| Route | What it does |
| --- | --- |
| `/login` | Sign in or create account |
| `/dashboard` | Live earnings, stats, 7-day chart, active contracts |
| `/plans` | Hash power plans with a confirm sheet |
| `/wallet` | Withdraw, deposit address, history |

## Wiring the backend

All data is placeholder. Replace these:

- `lib/data.js`: plans, contracts, history
- `lib/useMined.js`: simulated live earnings (swap for your API or websocket)
- `app/login/page.js`: `submit()` should call your auth
- `app/(app)/plans/page.js`: `pay()` should call your checkout
- `app/(app)/wallet/page.js`: `withdraw()` should call your withdrawal endpoint
