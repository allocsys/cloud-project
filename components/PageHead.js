'use client';
import Link from 'next/link';
import { markDrill } from '@/lib/nav';
import { useApi } from '@/lib/api';
import { useT } from '@/components/I18nProvider';

// The top bar of the tab screens: mountain logo, title, bell. The Earnings screen has its own version with the balance pill.
export default function PageHead({ title }) {
  const t = useT();
  const { data: nd } = useApi('/api/notifications', { ttl: 10000 });
  const unread = nd ? nd.unread : 0;
  return (
    <div className="top rich">
      <div className="eh-l">
        <span className="eh-logo" aria-hidden="true">
          <svg viewBox="0 0 40 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 29L15 11l6 9 4-6 12 15z" fill="currentColor" fillOpacity="0.22" />
            <path d="M6 3l11 11M5 8c3-5 8-6 12-4M34 3L23 14M35 8c-3-5-8-6-12-4" />
          </svg>
        </span>
        <div className="eh-ttl">
          <h2>{title}</h2>
        </div>
      </div>
      <div className="topact">
        <Link
          href="/notifications"
          className="bell"
          aria-label={unread ? t('dash.notifNew', { n: unread }) : t('dash.notif')}
          onClick={() => markDrill()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 8a6 6 0 1112 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 003.4 0" />
          </svg>
          {unread > 0 && <i />}
        </Link>
      </div>
    </div>
  );
}
