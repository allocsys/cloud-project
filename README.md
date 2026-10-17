# Opus Cloud Mining

Front end for a cloud mining app. Black and gold, responsive (bottom tabs on mobile, sidebar on desktop). Built with Next.js App Router, plain JavaScript, no UI libraries.

## Run

```bash
npm install
npm run dev
```

## Screens

| Route | What it does |
| --- | --- |
| `/login` | Sign in or create account |
| `/dashboard` | Live balance, stats, 7-day and all-time earnings chart, contracts with progress, live share feed |
| `/plans` | Hash power plans with hall details and a confirm sheet |
| `/wallet` | Withdraw, deposit address with QR code, activity |

Logged-in pages live in the `app/(app)/` route group. The parentheses keep the folder out of the URL and give those pages the shared nav and page transitions.

## Wiring the backend

All data is placeholder. Replace these:

- `lib/data.js`: halls, plans, contracts (with serials), activity, earnings series, BTC price, block height, deposit address
- `lib/useMined.js`: `useMinedFeed()` simulates the balance and share feed (swap for your API or websocket)
- `app/login/page.js`: `submit()` should call your auth. Remove the "Skip login for now" button once auth works
- `app/(app)/plans/page.js`: `pay()` should call your checkout. The contract serial shown in the sheet is a placeholder, your backend assigns the real one
- `app/(app)/wallet/page.js`: `withdraw()` should call your withdrawal endpoint

## Notes

- `lib/qr.js` is a small dependency-free QR encoder (byte mode, level M, up to 106 bytes), used for the deposit address.
- `lib/haptics.js` wraps haptic feedback for Telegram WebApp and mobile browsers.
- Animations always play, even when the device has reduced motion turned on.
