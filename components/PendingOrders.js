'use client';
// An open plan payment (the invoice made on Plans) can be reached from every main page:
// PendingCards shows a collapsed bar that opens the pay sheet (Wallet and Plans), PendingStrip is a thin line that opens Plans.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApi, post } from '@/lib/api';
import { useT } from '@/components/I18nProvider';
import { PayBar, PaySheet } from '@/components/PaySheet';
import { triggerHaptic } from '@/lib/haptics';
import { everyVisible } from '@/lib/visible';

const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

// Open plan invoices (kind plan is the default of /api/orders). Checks again every 5 seconds while one is open and `poll` is on.
function useOpenOrders(poll) {
  const { data, refresh, quiet } = useApi('/api/orders', { ttl: 10000 });
  const open = (data?.orders || []).filter((o) => o.status === 'pending' && o.address);
  const n = open.length;
  useEffect(() => {
    if (!n || !poll) return undefined;
    return everyVisible(() => quiet().catch(() => {}), 5000);
  }, [n, poll]);
  return { open, refresh, multi: !!data?.multi };
}

// `show` is the page's toast function. `poll` off: the page checks the orders itself (Plans).
// A page can open the sheet of a new order by sending the window event 'vtx-pay-open' with { id } (PendingCards waits for that order to appear).
export function PendingCards({ show, poll = true }) {
  const t = useT();
  const { open, refresh, multi } = useOpenOrders(poll);
  const [openId, setOpenId] = useState(null); // the order whose sheet is open
  const [want, setWant] = useState(null); // an order to open as soon as it appears in the list
  const [busy, setBusy] = useState(false); // a coin change is under way
  const [next, setNext] = useState(null); // the order a coin change made, until it shows in the list
  const last = useRef(null); // the last order shown, kept while a coin change is busy so nothing flickers
  const found = openId ? open.find((o) => o.id === openId) || null : null;
  if (found) last.current = found;
  const shown = found || (busy && openId ? last.current : null);

  useEffect(() => {
    const on = (e) => {
      const id = e.detail && e.detail.id;
      if (id) setWant(id);
    };
    window.addEventListener('vtx-pay-open', on);
    return () => window.removeEventListener('vtx-pay-open', on);
  }, []);
  useEffect(() => {
    if (!want) return undefined;
    if (open.some((o) => o.id === want)) {
      setOpenId(want);
      setWant(null);
      return undefined;
    }
    const id = setTimeout(() => setWant(null), 8000);
    return () => clearTimeout(id);
  }, [want, open]);
  // The new order of a coin change is in the list: the sheet switches to it (busy ends here, so it never closes in between).
  useEffect(() => {
    if (!next) return undefined;
    if (open.some((o) => o.id === next)) {
      setNext(null);
      setBusy(false);
      return undefined;
    }
    const id = setTimeout(() => {
      setNext(null);
      setBusy(false);
    }, 8000);
    return () => clearTimeout(id);
  }, [next, open]);
  // The order is gone (paid, expired, cancelled): close the sheet.
  useEffect(() => {
    if (openId && !want && !busy && !open.some((o) => o.id === openId)) setOpenId(null);
  }, [openId, want, busy, open]);

  async function cancelOrder(id) {
    triggerHaptic('light');
    setOpenId(null);
    try {
      await post('/api/orders/cancel', { id });
    } catch (e) {
      show(e.status ? e.message : t('common.noConnection'));
    }
    refresh().catch(() => {});
  }

  // A coin change = cancel the open order and make the same plan again in the new coin.
  async function switchCoin(o, c) {
    if (busy || !o.buy) return;
    last.current = o;
    setBusy(true);
    let made = null;
    try {
      await post('/api/orders/cancel', { id: o.id });
      const r = await post('/api/plans/buy', { ...o.buy, pay: 'crypto', asset: c.asset, network: c.net }, uid());
      await refresh().catch(() => {});
      if (r?.order?.id) {
        made = r.order.id;
        setOpenId(made);
        setNext(made);
      }
    } catch (e) {
      triggerHaptic('error');
      show(e.status ? e.message : t('common.noConnection'));
      await refresh().catch(() => {});
    } finally {
      if (!made) setBusy(false);
    }
  }

  return (
    <>
      {open.map((o) => (
        <PayBar
          key={o.id}
          order={o}
          onOpen={() => {
            triggerHaptic('light');
            setOpenId(o.id);
          }}
        />
      ))}
      {shown && (
        <PaySheet
          order={shown}
          show={show}
          busy={busy}
          canSwitch={multi && !!shown.buy}
          onClose={() => setOpenId(null)}
          onCancel={() => cancelOrder(shown.id)}
          onSwitch={(c) => switchCoin(shown, c)}
        />
      )}
    </>
  );
}

export function PendingStrip() {
  const t = useT();
  const path = usePathname() || '';
  // Plans and Wallet already show the full invoice.
  const hidden = path.includes('/plans') || path.includes('/wallet');
  const { open } = useOpenOrders(!hidden);
  const [now, setNow] = useState(() => Date.now());
  const n = open.length;
  useEffect(() => {
    if (!n || hidden) return undefined;
    return everyVisible(() => setNow(Date.now()), 1000);
  }, [n, hidden]);
  if (!n || hidden) return null;
  const end = Date.parse(open[0].expiresAt);
  const s = Number.isFinite(end) ? Math.max(0, Math.ceil((end - now) / 1000)) : null;
  const time = s === null ? '' : s === 0 ? t('pay.expired') : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  return (
    <Link
      href="/plans"
      onClick={() => triggerHaptic('light')}
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 10,
        margin: '0 0 12px',
        padding: '10px 14px',
        border: '1px solid var(--gold)',
        borderRadius: 12,
        color: 'inherit',
        textDecoration: 'none',
        fontSize: 14,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <span>
        <b>{t('plans.waiting')}</b>
        {time ? ` · ${time}` : ''}
      </span>
      <span aria-hidden="true">{'\u203a'}</span>
    </Link>
  );
}
