// One call for the dashboard's per-user data: miners, dashboard, wallet, referrals and notifications.
// The dashboard used to fire five separate requests that each loaded the same account document and
// the market — and wallet and referrals each ran the friend-rate lock on top. Here the document,
// the market and the referral context are loaded once and shared. The shared reads (plans
// catalogue, prices) stay on their own endpoints: they are edge-cached and polled on their own rhythm.
import { getUser } from '@/lib/server/db';
import { getMarket } from '@/lib/server/market';
import { getDashboard, getNotifications, getReferral } from '@/lib/server/account';
import { getMiners } from '@/lib/server/miners';
import { getWallet } from '@/lib/server/wallet';
import { lockFriendRates, refCtxFor } from '@/lib/server/referrals';

export async function getDashboardBundle(userId = 'demo') {
  const [u, market] = await Promise.all([getUser(userId), getMarket()]);
  // The referral lock runs once here, the way getRefCtx does it for a single caller.
  await lockFriendRates(userId);
  const ctx = await refCtxFor(u);
  const [miners, dashboard, wallet, referrals, notifications] = await Promise.all([
    getMiners(userId, { u, market }),
    getDashboard(userId, { u, market }),
    getWallet(userId, { ctx }),
    getReferral(userId, { ctx }),
    getNotifications(userId, { u }),
  ]);
  return { miners, dashboard, wallet, referrals, notifications };
}
