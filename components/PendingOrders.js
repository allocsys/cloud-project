'use client';
// An open plan payment (the invoice made on Plans) can be reached from every main page:
// PendingCards shows the full invoice (Wallet), PendingStrip is a thin line that opens Plans.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApi, post } from '@/lib/api';
import { useT } from '@/components/I18nProvider';
import { PayInfo } from '@/components/PayCoin';
import { triggerHaptic } from '@/lib/haptics';
import { fmtUsd } from '@/lib/data';

// Open plan invoices (kind plan is the default of /api/orders). Checks again every 5 seconds while one is open and `poll` is on.
function useOpenOrders(poll) {
  const { data, refresh } = useApi('/api/orders', { ttl: 10000 });
  const open = (data?.orders || []).filter((o) => o.status === 'pending' && o.address);
  const n = open.length;
  useEffect(() => {
    if (!n || !poll) return undefined;
    const id = setInterval(() => refresh().catch(() => {}), 5000);
    return () => clearInterval(id);
  }, [n, poll]);
  return { open, refresh };
}

// `show` is the page's toast function.
export function PendingCards({ show }) {
  const t = useT();
  const { open, refresh } = useOpenOrders(true);
  async function cancelOrder(id) {
    triggerHaptic('light');
    try {
      await post('/api/orders/cancel', { id });
    } catch (e) {
      show(e.status ? e.message : t('common.noConnection'));
    }
    refresh().catch(() => {});
  }
  return open.map((o) => (
    <div key={o.id} className="card">
      <div className="row" style={{ borderTop: 0 }}>
        <div>
          <b>{t('plans.waiting')}</b>
          <small style={{ display: 'block' }}>{o.label} · ${fmtUsd(o.usd)}</small>
          <PayInfo order={o} show={show} />
        </div>
        <div>
          <button type="button" className="linkbtn" onClick={() => cancelOrder(o.id)}>{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  ));
}

export function PendingStrip() {
  const t = useT();
  const path = usePathname() || '';
  // Plans and Wallet already show the full invoice.
  const hidden = path.includes('/plans') || path.includes('/wallet');
  const { open, refresh } = useOpenOrders(!hidden);
  const [now, setNow] = useState(() => Date.now());
  const n = open.length;
  // A new invoice made on Plans shows up as soon as the person moves to another page.
  useEffect(() => {
    refresh().catch(() => {});
  }, [path]);
  useEffect(() => {
    if (!n || hidden) return undefined;
    const id = setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, 1000);
    return () => clearInterval(id);
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
