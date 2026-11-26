'use client';
// Shared pieces of the Settings menu and its sub-pages.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { drillBack, markDrill } from '@/lib/nav';
import { triggerHaptic } from '@/lib/haptics';
import { securityLevel } from '@/lib/security-level';
import { useT } from '@/components/I18nProvider';

const LEVELS = { low: ['set.low', 'warn'], medium: ['set.medium', ''], high: ['set.high', 'ok'] };

export function LevelBadge({ me }) {
  const t = useT();
  const [key, cls] = LEVELS[securityLevel(me)];
  return <span className={`badge ${cls}`}>{t(key)}</span>;
}

export function Switch({ on, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className="switch" onClick={onChange}>
      <i />
    </button>
  );
}

// One row of the menu: title on the left, status and a chevron on the right. The whole row opens the sub-page.
export function NavRow({ href, title, children }) {
  return (
    <Link
      href={href}
      className="row set-nav"
      onClick={() => {
        triggerHaptic('selection');
        markDrill();
      }}
    >
      <span className="set-t">{title}</span>
      <span className="set-v">
        {children}
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 5l7 7-7 7" />
        </svg>
      </span>
    </Link>
  );
}

// The top bar of a sub-page: back button and title.
export function SubHead({ title }) {
  const t = useT();
  const router = useRouter();
  return (
    <div className="top rich">
      <div className="eh-l">
        <button type="button" className="back" aria-label={t('kyc.backSettings')} onClick={() => drillBack(router, '/settings')}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <div className="eh-ttl">
          <h2>{title}</h2>
        </div>
      </div>
    </div>
  );
}
