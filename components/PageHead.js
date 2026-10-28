'use client';
import Link from 'next/link';
import { markDrill } from '@/lib/nav';
import { useApi } from '@/lib/api';
import { useT } from '@/components/I18nProvider';

// One small outline icon per screen, drawn on a 24 grid.
const ICONS = {
  earnings: 'M3 19l6-10 4 6 3-4 5 8zM17 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1z',
  plans: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9',
  invite: 'M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7C9 7 7.5 5.5 8.5 4.5S11.5 5 12 7zM12 7c3 0 4.5-1.5 3.5-2.5S12.5 5 12 7z',
  wallet: 'M3 7a2 2 0 012-2h13v3M3 7v10a2 2 0 002 2h15V8H5a2 2 0 01-2-1zM16 13.5h2',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 4v6M9 14v6',
};

// The gold tile with the screen's icon. The Earnings screen uses it too.
export function HeadIcon({ kind }) {
  return (
    <span className="eh-logo" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d={ICONS[kind] || ICONS.earnings} />
      </svg>
    </span>
  );
}

// The top bar of the tab screens: icon tile, title, bell. The Earnings screen has its own version with the balance pill.
export default function PageHead({ title, icon }) {
  const t = useT();
  const { data: nd } = useApi('/api/notifications', { ttl: 10000 });
  const unread = nd ? nd.unread : 0;
  return (
    <div className="top rich">
      <div className="eh-l">
        <HeadIcon kind={icon} />
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
