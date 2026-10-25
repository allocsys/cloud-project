// Wallet history and withdrawals. Storage lives in lib/server/db.js.
// A withdrawal is a request: the balance is reserved at once and a row is saved as 'pending'. Nothing is paid until an
// admin approves it and the payout is made (statuses: pending, approved, sent, failed, rejected).
// The balance is worked out on read: mining earnings + invite rewards + admin adjustments - withdrawn - spent on plans.
import { randomBytes } from 'node:crypto';
import { MIN_WITHDRAW_USD, BTC_USD } from '@/lib/data';
import { buildEarnings, payoutDays } from '@/lib/earnings';
import { ASSETS, NETWORKS, quote } from '@/lib/assets';
import { getPrices } from '@/lib/server/prices';
import { getMarket } from '@/lib/server/market';
import { withUser, withIdem, idemGet, ledger, notify, q as dbq } from '@/lib/server/db';
import { serviceTier } from '@/lib/service-fee';
import { lockedBtc } from '@/lib/deposit-hold';
import { boostBtcOf } from '@/lib/boost';
import { getRefCtx, refCtxFor, rewardBtcOf, historyOfCtx } from '@/lib/server/referrals';

export const TOLERANCE = 2e-6; // BTC. Covers the browser's simulated ticks running slightly ahead.

function dateLabel(h, now) {
  if (!h.at) return h.date;
  if (now - h.at < 60_000) return 'Just now';
  return new Date(h.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// The saved activity plus what is worked out on read: invite income (see referrals.js) and the daily mining payouts.
// The demo account is a normal account with no sample payout rows, so every account gets the derived ones.
function history(ctx) {
  const { u } = ctx;
  const now = Date.now();
  const payouts = payoutDays(u.contracts, now, BTC_USD, 30, ctx.market).map((p) => ({ kind: 'payout', label: 'Daily payout', at: p.at, amount: `+${p.btc.toFixed(8)}`, coin: 'BTC', net: 'BTC' }));
  const extra = [...historyOfCtx(ctx, now), ...payouts];
  if (!extra.length) return u.history;
  return [...u.history, ...extra].sort((a, b) => (b.at || 0) - (a.at || 0));
}

// Everything earned so far, in BTC: only what the account's own miners and rewards produced. u.adjust is the signed
// total of balance changes made by an admin (see admin.js). Finished boosts (pay and prize, lib/boost.js) count from the moment they end.
// u.deposited is the BTC credited from paid wallet top-ups (startDeposit and settleOrder in miners.js).
const earnedOf = (ctx, now = Date.now()) => buildEarnings(ctx.u.contracts, now, BTC_USD, ctx.market).totalBtc + rewardBtcOf(ctx) + (ctx.u.adjust || 0) + boostBtcOf(ctx.u, now) + (ctx.u.deposited || 0);

// Balance that can still be withdrawn or spent on a plan, in BTC, from a loaded context.
export const availableOf = (ctx) => earnedOf(ctx) - ctx.u.withdrawn - (ctx.u.spent || 0);

// The same, for a user document the caller has locked inside a transaction (pass its client).
export async function availableIn(c, u) {
  return availableOf(await refCtxFor(u, c));
}

// The moment the withdrawal service fee counts from (lib/service-fee.js): the account's last withdrawal that was not
// failed or rejected, else its first purchase, else now (no purchase yet: the clock has not started, so the top tier applies).
// `c` is a client when the caller holds a lock.
export async function serviceSince(u, c) {
  const r = await dbq("SELECT max(at) AS at FROM withdrawals WHERE user_id = $1 AND status NOT IN ('failed', 'rejected')", [u.id], c);
  const last = Number(r.rows[0]?.at) || 0;
  if (last) return last;
  const buys = u.history.filter((h) => h.kind === 'purchase' && h.at && !h.refunded).map((h) => h.at);
  return buys.length ? Math.min(...buys) : Date.now();
}

export async function getWallet(userId = 'demo') {
  const ctx = await getRefCtx(userId);
  const now = Date.now();
  return {
    svcSince: await serviceSince(ctx.u),
    earned: earnedOf(ctx, now),
    mined: buildEarnings(ctx.u.contracts, now, BTC_USD, ctx.market).totalBtc, // mining only: what the dashboard shows as Total mined
    withdrawn: ctx.u.withdrawn,
    spent: ctx.u.spent || 0, // BTC of the balance used to pay for plans
    history: history(ctx).map((h) => ({ ...h, date: dateLabel(h, now) })),
    asOf: now,
  };
}

const fail = (status, error, field) => ({ ok: false, status, error, field });

// Validates against server prices and the server ledger, then applies the withdrawal.
// Same Idempotency-Key twice returns the first result instead of withdrawing twice.
export async function withdraw(input, { userId = 'demo', key } = {}) {
  const idemKey = key ? `withdraw:${userId}:${key}` : null;
  const prior = await idemGet(idemKey);
  if (prior) return prior;

  const asset = String(input?.asset ?? '');
  const net = String(input?.net ?? '');
  const amount = Number(input?.amount);
  const address = String(input?.address ?? '').trim();

  const A = Object.hasOwn(ASSETS, asset) ? ASSETS[asset] : null;
  if (!A || !Object.hasOwn(A.nets, net)) return fail(400, 'Unknown coin or network.');
  if (!Number.isFinite(amount) || amount <= 0) return fail(422, 'Enter an amount to withdraw.', 'amount');
  if (!NETWORKS[net].pattern.test(address)) return fail(422, `Enter a valid ${NETWORKS[net].label} address.`, 'address');

  const { prices } = await getPrices();
  await getMarket(); // warms the market cache now, so nothing slow happens while the account is locked
  const q0 = quote(asset, net, amount, prices);
  if (q0.usd < MIN_WITHDRAW_USD - 0.01) return fail(422, `Below the minimum of $${MIN_WITHDRAW_USD}.`, 'amount');

  // The balance check and the spend happen under the account's row lock, so no other request can slip in between.
  return withUser(userId, (u, c) =>
    withIdem(c, idemKey, async () => {
      if (!u) return fail(404, 'Account not found.');
      // The service fee depends on when this account last withdrew, so it is worked out here, under the lock.
      const tier = serviceTier(await serviceSince(u, c));
      const q = quote(asset, net, amount, prices, tier.pct);
      if (q.receive <= 0) return fail(422, 'Too small to cover the fees.', 'amount');
      const available = await availableIn(c, u);
      if (q.btc > available + TOLERANCE) return fail(409, 'More than your available balance.', 'amount');
      // Without a plan, each deposit stays locked for 14 days from its own date (lib/deposit-hold.js); the rest can go at once.
      if (q.btc > available - lockedBtc(u) + TOLERANCE) return fail(409, 'Without a plan, deposits can be withdrawn after 14 days.');

      const wid = `wd_${randomBytes(9).toString('base64url')}`;
      const entry = {
        kind: 'withdrawal',
        wid,
        status: 'pending',
        label: `Withdrawal · ${A.sym}`,
        date: 'Just now',
        at: Date.now(),
        amount: `-${amount.toFixed(A.dec)}`,
        coin: A.sym,
        net: NETWORKS[net].short,
        fee: `${q.netFee} ${A.sym}${q.swapUsd ? ` + $${q.swapUsd.toFixed(2)} swap` : ''}${q.svcUsd ? ` + $${q.svcUsd.toFixed(2)} service` : ''}`,
      };
      u.withdrawn += q.btc;
      u.history.unshift(entry);
      await c.query('INSERT INTO withdrawals (id, user_id, status, at, data, idem_key) VALUES ($1, $2, $3, $4, $5::jsonb, $6)', [
        wid,
        userId,
        'pending',
        entry.at,
        JSON.stringify({ id: wid, asset, net, address, amount, btc: q.btc, receive: q.receive, netFee: q.netFee, swapUsd: q.swapUsd || 0, svcPct: tier.pct, svcUsd: q.svcUsd || 0, usd: q.usd, at: entry.at }),
        idemKey,
      ]);
      notify(u, { kind: 'withdrawal', title: 'Withdrawal requested', body: `${amount.toFixed(A.dec)} ${A.sym} is waiting for approval`, code: 'wdReq', vars: { amt: `${amount.toFixed(A.dec)} ${A.sym}` } });
      await ledger(c, userId, 'withdrawal', { btc: q.btc, ref: `${wid} ${A.sym}/${NETWORKS[net].short} pending` });

      return { ok: true, status: 200, entry, id: wid, withdrawn: u.withdrawn, receive: q.receive, receiveUsd: q.receiveUsd };
    }),
  );
}
