'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { notifications } from '@/lib/data';
import { useApi, post } from '@/lib/api';
import { drillBack } from '@/lib/nav';

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

  useEffect(() => {
    if (!nd || fresh) return;
    const ids = new Set(nd.items.filter((n) => !n.read).map((n) => n.id));
    setFresh(ids);
    if (ids.size) {
      mutate({ ...nd, items: nd.items.map((n) => ({ ...n, read: true })), unread: 0 });
      post('/api/notifications/read', {}).catch(() => {});
    }
  }, [nd, fresh, mutate]);

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
      </div>

      <div className="card">
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
