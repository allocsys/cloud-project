'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { notifications } from '@/lib/data';
import { useApi, post, revalidate } from '@/lib/api';
import { drillBack } from '@/lib/nav';
import { triggerHaptic } from '@/lib/haptics';

const KIND = {
  payout: { glyph: '↓', cls: 'in' },
  referral: { glyph: '+', cls: 'in' },
  withdrawal: { glyph: '↑', cls: 'out' },
  purchase: { glyph: '◆', cls: 'buy' },
  news: { glyph: 'i', cls: 'buy' },
};

const chev = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M15 5l-7 7 7 7" />
  </svg>
);

// Shown until the server answers the first time.
const seedItems = notifications.map((n) => ({ ...n, read: false }));

export default function Notifications() {
  const router = useRouter();
  const { data: nd, mutate } = useApi('/api/notifications', { ttl: 5000 });
  const items = nd ? nd.items : seedItems;
  // Ids that were new when the screen opened. They keep their dot while you read, then count as read.
  const [fresh, setFresh] = useState(null);
  // The list keeps its place but stays hidden until the server has answered (or 1.5 seconds), so the sample items never flash.
  const [wait, setWait] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setWait(false), 1500);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!nd || fresh) return;
    const ids = new Set(nd.items.filter((n) => !n.read).map((n) => n.id));
    setFresh(ids);
    if (ids.size) {
      mutate({ ...nd, items: nd.items.map((n) => ({ ...n, read: true })), unread: 0 });
      post('/api/notifications/read', {}).catch(() => {});
    }
  }, [nd, fresh, mutate]);

  // Empties the list at once, then tells the server. Puts the list back if the server says no.
  async function clearAll() {
    if (!items.length) return;
    triggerHaptic('medium');
    const before = nd;
    mutate({ items: [], unread: 0 });
    try {
      await post('/api/notifications/clear', {});
    } catch {
      triggerHaptic('error');
      if (before) mutate(before);
      revalidate('/api/notifications').catch(() => {});
    }
  }

  return (
    <>
      <div className="top">
        <div className="tl">
          <Link
            href="/dashboard"
            className="back"
            aria-label="Back to earnings"
            onClick={(e) => {
              e.preventDefault();
              drillBack(router, '/dashboard');
            }}
          >
            {chev}
          </Link>
          <h2>Notifications</h2>
        </div>
        {items.length > 0 && (
          <button
            className="swap"
            type="button"
            onClick={clearAll}
            style={{ width: 'auto', minHeight: 40, margin: 0, padding: '0 12px' }}
          >
            Clear all
          </button>
        )}
      </div>

      <div className="card" style={nd || !wait ? undefined : { visibility: 'hidden' }}>
        {items.length ? (
          items.map((n, i) => {
            const k = KIND[n.kind] || KIND.news;
            return (
              <div key={n.id} className="row" style={i === 0 ? { borderTop: 0, alignItems: 'flex-start' } : { alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, minWidth: 0 }}>
                  <span className={`kind ${k.cls}`} aria-hidden="true">{k.glyph}</span>
                  <div>
                    <div style={{ fontWeight: 500 }}>{n.title}</div>
                    <small>{n.body}</small>
                  </div>
                </div>
                <div className="nmeta">
                  {fresh && fresh.has(n.id) && <i className="ndot" aria-label="New" />}
                  <small>{n.when}</small>
                </div>
              </div>
            );
          })
        ) : (
          <p className="empty">No notifications yet.</p>
        )}
      </div>
    </>
  );
}
