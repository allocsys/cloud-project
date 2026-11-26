// One call for the dashboard's per-user data: miners, dashboard, wallet, referrals and notifications.
// The dashboard used to fire five separate requests that each loaded the same account document and
// the market — and wallet and referrals each ran the friend-rate lock on top. Here the document,
// the market and the referral context are loaded once and shared. The shared reads (plans
// catalogue, prices) stay on their own endpoints: they are edge-cached and polled on their own rhythm.
import { getUser } from '@/lib/server/db';
import { getMarket } from '@/lib/server/market';
import { getDashboard, getNotifications, getReferral, getSettings } from '@/lib/server/account';
import { getMiners, getMiner, getOrders } from '@/lib/server/miners';
import { getBoosts } from '@/lib/server/boost';
import { getKyc } from '@/lib/server/kyc';
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

// The Plans page: miners, balances (no history rows), the open plan orders and the boost tickets.
export async function getPlansBundle(userId = 'demo') {
  const [miners, wallet, orders, boost] = await Promise.all([
    getMiners(userId),
    getWallet(userId, undefined, { limit: 0 }),
    getOrders(userId, 'plan'),
    getBoosts(userId),
  ]);
  return { miners, wallet, orders, boost };
}

// The Settings page: alerts, verification and the account.
export async function getSettingsBundle(userId = 'demo') {
  const [settings, kyc, me] = await Promise.all([getSettings(userId), getKyc(userId), whoami(userId)]);
  return { settings, kyc, me };
}

// One miner page: the miners list and that miner's own details (detail is null when the serial is not this account's).
export async function getMinerBundle(userId = 'demo', serial = '') {
  const [miners, contract] = await Promise.all([getMiners(userId), getMiner(serial, userId)]);
  return { miners, detail: contract ? { contract } : null };
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
