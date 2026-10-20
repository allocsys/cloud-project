// Wallet history and withdrawals. Storage lives in lib/server/db.js.
// A withdrawal is a request: the balance is reserved at once and a row is saved as 'pending'. Nothing is paid until an
// admin approves it and the payout is made (statuses: pending, approved, sent, failed, rejected).
// The balance is worked out on read: mining earnings + invite rewards - withdrawn - spent on plans.
import { randomBytes } from 'node:crypto';
import { MIN_WITHDRAW, CREDIT_BTC, BTC_USD } from '@/lib/data';
import { buildEarnings, payoutDays } from '@/lib/earnings';
import { ASSETS, NETWORKS, quote } from '@/lib/assets';
import { getPrices } from '@/lib/server/prices';
import { withUser, withIdem, idemGet, ledger, notify } from '@/lib/server/db';
import { getRefCtx, refCtxFor, rewardBtcOf, historyOfCtx } from '@/lib/server/referrals';

export const TOLERANCE = 2e-6; // BTC. Covers the browser's simulated ticks running slightly ahead.

function dateLabel(h, now) {
  if (!h.at) return h.date;
  if (now - h.at < 60_000) return 'Just now';
  return new Date(h.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// The saved activity plus what is worked out on read: invite income (see referrals.js) and the daily mining payouts.
// The demo account already has sample payout rows, so only real accounts get derived ones.
function history(ctx) {
  const { u } = ctx;
  const now = Date.now();
  const payouts = u.id === 'demo' ? [] : payoutDays(u.contracts, now, BTC_USD).map((p) => ({ kind: 'payout', label: 'Daily payout', at: p.at, amount: `+${p.btc.toFixed(8)}`, coin: 'BTC', net: 'BTC' }));
  const extra = [...historyOfCtx(ctx, now), ...payouts];
  if (!extra.length) return u.history;
  return [...u.history, ...extra].sort((a, b) => (b.at || 0) - (a.at || 0));
}

// Everything earned so far, in BTC. CREDIT_BTC is the demo account's sample balance; real accounts earn only from
// their own miners and rewards.
const earnedOf = (ctx, now = Date.now()) => (ctx.u.id === 'demo' ? CREDIT_BTC : 0) + buildEarnings(ctx.u.contracts, now).totalBtc + rewardBtcOf(ctx);

// Balance that can still be withdrawn or spent on a plan, in BTC, from a loaded context.
export const availableOf = (ctx) => earnedOf(ctx) - ctx.u.withdrawn - (ctx.u.spent || 0);

// The same, for a user document the caller has locked inside a transaction (pass its client).
export async function availableIn(c, u) {
  return availableOf(await refCtxFor(u, c));
}

export async function getWallet(userId = 'demo') {
  const ctx = await getRefCtx(userId);
  const now = Date.now();
  return {
    earned: earnedOf(ctx, now),
    mined: buildEarnings(ctx.u.contracts, now).totalBtc, // mining only: what the dashboard shows as Total mined
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
  const q = quote(asset, net, amount, prices);
  if (q.btc < MIN_WITHDRAW) return fail(422, `Below the minimum of ${MIN_WITHDRAW} BTC.`, 'amount');
  if (q.receive <= 0) return fail(422, 'Too small to cover the fees.', 'amount');

  // The balance check and the spend happen under the account's row lock, so no other request can slip in between.
  return withUser(userId, (u, c) =>
    withIdem(c, idemKey, async () => {
      if (!u) return fail(404, 'Account not found.');
      const available = await availableIn(c, u);
      if (q.btc > available + TOLERANCE) return fail(409, 'More than your available balance.', 'amount');

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
        fee: `${q.netFee} ${A.sym}${q.swapUsd ? ` + $${q.swapUsd.toFixed(2)} swap` : ''}`,
      };
      u.withdrawn += q.btc;
      u.history.unshift(entry);
      await c.query('INSERT INTO withdrawals (id, user_id, status, at, data, idem_key) VALUES ($1, $2, $3, $4, $5::jsonb, $6)', [
        wid,
        userId,
        'pending',
        entry.at,
        JSON.stringify({ id: wid, asset, net, address, amount, btc: q.btc, receive: q.receive, netFee: q.netFee, swapUsd: q.swapUsd || 0, usd: q.usd, at: entry.at }),
        idemKey,
      ]);
      notify(u, { kind: 'withdrawal', title: 'Withdrawal requested', body: `${amount.toFixed(A.dec)} ${A.sym} is waiting for approval` });
      await ledger(c, userId, 'withdrawal', { btc: q.btc, ref: `${wid} ${A.sym}/${NETWORKS[net].short} pending` });

      return { ok: true, status: 200, entry, id: wid, withdrawn: u.withdrawn, receive: q.receive, receiveUsd: q.receiveUsd };
    }),
  );
}
