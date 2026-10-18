'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { triggerHaptic } from '@/lib/haptics';

const icon = (d) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={d} />
  </svg>
);

// Plans sits in the middle as the raised main action.
const items = [
  { href: '/dashboard', label: 'Earnings', d: 'M4 13h6V4H4zM14 20h6V4h-6zM4 20h6v-3H4z' },
  { href: '/wallet', label: 'Wallet', d: 'M3 8a3 3 0 013-3h12a3 3 0 013 3v8a3 3 0 01-3 3H6a3 3 0 01-3-3zM3 10h18M16 14.5h2' },
  { href: '/plans', label: 'Plans', fab: true, d: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5' },
  { href: '/referrals', label: 'Invite', d: 'M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7c-1-3-5-3.5-5-1.5S10 7 12 7zM12 7c1-3 5-3.5 5-1.5S14 7 12 7z' },
  { href: '/settings', label: 'Settings', d: 'M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6' },
];

export default function Nav() {
  const path = usePathname();

  function onNavClick(href) {
    if (path !== href) {
      triggerHaptic('selection');
    }
  }

  return (
    <nav aria-label="Main">
      <div className="brand">
        <div className="mark">O</div>Opus
      </div>
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-label={i.label}
          aria-current={path === i.href || (i.href === '/plans' && path.startsWith('/miners/')) ? 'page' : undefined}
          className={i.fab ? 'fab' : undefined}
          onClick={() => onNavClick(i.href)}
        >
          <span className="ind">{icon(i.d)}</span>
          <span className="lbl">{i.label}</span>
        </Link>
      ))}
      <Link
        href="/login"
        className="out"
        onClick={() => triggerHaptic('medium')}
      >
        <span className="ind">{icon('M9 4H5v16h4M16 8l4 4-4 4M20 12H9')}</span>
        Sign out
      </Link>
    </nav>
  );
}
