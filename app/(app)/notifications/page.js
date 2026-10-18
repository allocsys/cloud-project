'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { notifications } from '@/lib/data';
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

export default function Notifications() {
  const router = useRouter();
  const [fresh, setFresh] = useState(0);

  // Placeholder read state. Your API should say which notifications are new.
  useEffect(() => {
    try {
      const seen = parseInt(localStorage.getItem('opus-notif-seen') || '0', 10) || 0;
      setFresh(Math.max(0, notifications.length - seen));
      localStorage.setItem('opus-notif-seen', String(notifications.length));
    } catch {}
  }, []);

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
        {notifications.length ? (
          notifications.map((n, i) => {
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
                  {i < fresh && <i className="ndot" aria-label="New" />}
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
