// Deposit bonus event: while it runs, every paid top-up earns free boost tickets (lib/boost.js giftBoost), one for every `perUsd` dollars.
// Pure (no storage), so the server, the admin screen and the tests work out the same numbers. Settings live in the meta entry "event":
//   { enabled, id, startAt, endsAt, perUsd, ticket (t1, t10 or t100), maxPerUser (0 = no limit), name (the occasion, e.g. "Black Friday"; empty = none) }
// A deposit counts when its order was started inside the event (startAt..endsAt), so a slow payment still earns the bonus.
import { ticketOf } from '@/lib/boost';

export const EVENT_MAX = { perUsd: 100000, days: 90, maxPerUser: 1000, perDeposit: 20, name: 30 }; // perDeposit: tickets one deposit can earn, a safety cap
export const EVENT_DEFAULTS = { enabled: false, id: '', startAt: 0, endsAt: 0, perUsd: 50, ticket: 't10', maxPerUser: 0, name: '' };

const time = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);

// The occasion name as shown: no control characters, one space between words, at most EVENT_MAX.name characters.
export const cleanName = (v) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();

// Saved settings (or nothing) as a full, valid set. Anything missing or out of range falls back to the default.
export function normalizeEvent(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const per = Number(r.perUsd);
  const max = Math.floor(Number(r.maxPerUser));
  return {
    enabled: r.enabled === true,
    id: typeof r.id === 'string' ? r.id.slice(0, 24) : '',
    startAt: time(r.startAt),
    endsAt: time(r.endsAt),
    perUsd: Number.isFinite(per) && per >= 1 && per <= EVENT_MAX.perUsd ? Math.round(per * 100) / 100 : EVENT_DEFAULTS.perUsd,
    ticket: ticketOf(r.ticket) ? r.ticket : EVENT_DEFAULTS.ticket,
    maxPerUser: Number.isFinite(max) && max >= 0 && max <= EVENT_MAX.maxPerUser ? max : 0,
    name: typeof r.name === 'string' ? cleanName(r.name).slice(0, EVENT_MAX.name) : '',
  };
}

// Is the event running for an order started at `at` (milliseconds)?
export const eventLive = (ev, at) => !!ev?.enabled && Number(at) >= ev.startAt && Number(at) <= ev.endsAt;

// Tickets a deposit of `usd` earns: whole steps only ($120 at one per $50 is 2), at most EVENT_MAX.perDeposit, and never more than
// the per-user limit leaves (`got` = tickets this account already earned in this event).
export function eventTickets(ev, usd, got = 0) {
  let n = Math.min(Math.floor((Number(usd) + 1e-9) / ev.perUsd), EVENT_MAX.perDeposit);
  if (ev.maxPerUser > 0) n = Math.min(n, ev.maxPerUser - got);
  return Math.max(0, n);
}
