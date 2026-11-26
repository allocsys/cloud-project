// One call for the dashboard's per-user data: miners, dashboard, wallet, referrals and notifications.
// The dashboard used to fire five separate requests that each loaded the same account document and
// the market — and wallet and referrals each ran the friend-rate lock on top. Here the document,
// the market and the referral context are loaded once and shared. The shared reads (plans
// catalogue, prices) stay on their own endpoints: they are edge-cached and polled on their own rhythm.
import { getUser } from '@/lib/server/db';
import { getMarket } from '@/lib/server/market';
import { getDashboard, getNotifications, getReferral } from '@/lib/server/account';
import { getMiners, getOrders } from '@/lib/server/miners';
import { whoami } from '@/lib/server/auth';
import { getWallet } from '@/lib/server/wallet';
import { lockFriendRates, refCtxFor } from '@/lib/server/referrals';

// The wallet page's per-user data in one call: miners, the first page of history, the deposit orders and the account.
// Prices and the plans catalogue stay on their own edge-cached endpoints.
export async function getWalletBundle(userId = 'demo') {
  const [miners, wallet, orders, me] = await Promise.all([
    getMiners(userId),
    getWallet(userId, undefined, { limit: 20, offset: 0, kind: 'all' }),
    getOrders(userId, 'deposit'),
    whoami(userId),
  ]);
  return { miners, wallet, orders, me };
}

export async function getDashboardBundle(userId = 'demo') {
  const [market] = await Promise.all([getMarket(), lockFriendRates(userId)]);
  // The referral lock runs once here, the way getRefCtx does it for a single caller.
  // The user is loaded after the lock, not before it: locking can change the inviter (VIP level seen,
  // notifications), so the context below must not reuse a snapshot from before it.
  const u = await getUser(userId);
  const ctx = await refCtxFor(u);
  const [miners, dashboard, wallet, referrals, notifications] = await Promise.all([
    getMiners(userId, { u, market }),
    getDashboard(userId, { u, market }),
    getWallet(userId, { ctx }, { limit: 0 }), // the dashboard needs balances only, not the history rows
    getReferral(userId, { ctx }),
    getNotifications(userId, { u }),
  ]);
  return { miners, dashboard, wallet, referrals, notifications };
}
