// Deposit bonus event: settings, the banner and handing out the tickets. Rules and maths: lib/event.js.
// The tickets are free boosts (gift: true) that start the moment the deposit is credited, so there is nothing to claim. They are
// drawn at the real chance of the boost settings, like any free ticket. They only run while boost tickets are on.
import { randomBytes, randomInt } from 'node:crypto';
import { warm, metaGet, metaUpdate, notify } from '@/lib/server/db';
import { normalizeBoost, boostOn, giftBoost, ticketOf } from '@/lib/boost';
import { normalizeEvent, eventLive, eventTickets, EVENT_MAX } from '@/lib/event';

const fail = (status, error) => ({ ok: false, status, error });
const num = (v) => (v === null || v === undefined || String(v).trim() === '' ? NaN : Number(String(v).trim().replace(',', '.')));

export async function eventSettings() {
  await warm();
  return normalizeEvent(metaGet('event'));
}

// What a credited deposit needs, read before any account is locked: the event and the boost settings, or null when nothing can be given.
export async function eventContext() {
  await warm();
  const ev = normalizeEvent(metaGet('event'));
  if (!ev.enabled) return null;
  const cfg = normalizeBoost(metaGet('boost'));
  return boostOn(cfg) ? { ev, cfg } : null;
}

// The running event as the deposit screen may see it, or null.
export async function liveEvent(now = Date.now()) {
  const ctx = await eventContext();
  if (!ctx || !eventLive(ctx.ev, now)) return null;
  return { perUsd: ctx.ev.perUsd, price: ticketOf(ctx.ev.ticket).price, endsAt: ctx.ev.endsAt };
}

// Gives the tickets a paid deposit earns. Runs inside the account's transaction, once per deposit (the caller only credits a deposit once).
// Returns how many tickets were given.
export function grantEvent(u, order, rate, ctx, now = Date.now()) {
  if (!ctx || !(rate > 0) || !eventLive(ctx.ev, order.at)) return 0;
  const got = Number(u.evGot?.[ctx.ev.id]) || 0;
  const n = eventTickets(ctx.ev, order.usd, got);
  if (!n) return 0;
  const t = ticketOf(ctx.ev.ticket);
  for (let i = 0; i < n; i += 1) {
    (u.boosts ||= []).push(giftBoost({ id: `bst_${randomBytes(6).toString('base64url')}`, cfg: ctx.cfg, rate, now, roll: randomInt(1_000_000), ticket: t.id }));
  }
  u.evGot = { [ctx.ev.id]: got + n }; // only the running event is kept
  u.history.unshift({ kind: 'boost-buy', label: `Deposit bonus · ${n} × $${t.price}`, date: 'Just now', at: now, amount: 'Free', net: 'Balance' });
  notify(u, { kind: 'purchase', title: 'Deposit bonus', body: `${n} × $${t.price} boost ticket added for your deposit. The boost started right away.`, code: 'depEvt', vars: { c: n, p: t.price } });
  return n;
}

// Saves what is given and leaves the rest as it is. `start: true` begins a new event now that runs `days` days (a new id, so the
// per-user limit starts over); `stop: true` ends it at once. Changed numbers apply to deposits credited after saving.
export async function saveEvent(input) {
  const patch = {};
  if (input?.perUsd !== undefined) {
    const v = num(input.perUsd);
    if (!(v >= 1 && v <= EVENT_MAX.perUsd)) return fail(422, `Dollars per ticket must be between 1 and ${EVENT_MAX.perUsd}.`);
    patch.perUsd = Math.round(v * 100) / 100;
  }
  if (input?.ticket !== undefined) {
    if (!ticketOf(String(input.ticket))) return fail(422, 'Unknown ticket.');
    patch.ticket = String(input.ticket);
  }
  if (input?.maxPerUser !== undefined) {
    const v = num(input.maxPerUser);
    if (!(Number.isInteger(v) && v >= 0 && v <= EVENT_MAX.maxPerUser)) return fail(422, `Max tickets per user must be a whole number from 0 to ${EVENT_MAX.maxPerUser} (0 = no limit).`);
    patch.maxPerUser = v;
  }
  const start = input?.start === true;
  const stop = input?.stop === true;
  let days = 0;
  if (start) {
    days = num(input?.days);
    if (!(days >= 0.1 && days <= EVENT_MAX.days)) return fail(422, `The event must run from 0.1 to ${EVENT_MAX.days} days.`);
    await warm();
    if (!boostOn(normalizeBoost(metaGet('boost')))) return fail(409, 'Boost tickets are off. Turn them on in the Boost tickets card first.');
  }
  return metaUpdate('event', (cur) => {
    let next = { ...normalizeEvent(cur), ...patch };
    const now = Date.now();
    if (stop) next.enabled = false;
    if (start) next = { ...next, enabled: true, id: randomBytes(5).toString('hex'), startAt: now, endsAt: now + Math.round(days * 86400000) };
    next = normalizeEvent(next);
    return { value: next, result: { ok: true, status: 200, event: next } };
  });
}
