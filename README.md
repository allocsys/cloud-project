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
| `/login` | Sign in or create account, with inline field errors |
| `/dashboard` | Live balance with hash rate, today, uptime and latest share chips, scrubbable 7-day and all-time earnings chart, contract progress |
| `/plans` | Plan tiles with animated rig art. Tap one for a confirm sheet (hall, power, contract serial, total) |
| `/wallet` | Withdraw with percentage shortcuts and validation, deposit address with QR code, collapsible activity |
| `/referrals` | Referral earnings, invite code with share and copy, friends list |
| `/settings` | Email, verification status, two-factor and alert switches, sign out |

Logged-in pages live in the `app/(app)/` route group. The parentheses keep the folder out of the URL and give those pages the shared nav and page transitions.

## Wiring the backend

All data is placeholder. Replace these:

- `lib/data.js`: halls, plans, contracts (with serials), activity, earnings series, referral data, account (email, KYC status, 2FA, alerts), deposit address, minimum withdrawal
- `lib/useMined.js`: `useMinedFeed()` simulates the balance and share feed (swap for your API or websocket)
- `app/login/page.js`: `submit()` should call your auth. Remove the "Skip login for now" button once auth works
- `app/(app)/plans/page.js`: `pay()` should call your checkout. The contract serial shown in the sheet is a placeholder, your backend assigns the real one
- `app/(app)/wallet/page.js`: `withdraw()` should call your withdrawal endpoint
- `app/(app)/referrals/page.js`: build the invite link from your real referral URL
- `app/(app)/settings/page.js`: persist the 2FA and alert switches, and wire the "Coming soon" actions (email, password, verification)

## Notes

- `lib/qr.js` is a small dependency-free QR encoder (byte mode, level M, up to 106 bytes), used for the deposit address.
- `lib/haptics.js` wraps haptic feedback for Telegram WebApp and mobile browsers.
- Animations always play, even when the device has reduced motion turned on.
