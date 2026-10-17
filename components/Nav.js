'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const icon = (d) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={d} />
  </svg>
);

const items = [
  { href: '/dashboard', label: 'Earnings', d: 'M4 13h6V4H4zM14 20h6V4h-6zM4 20h6v-3H4z' },
  { href: '/plans', label: 'Plans', d: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5' },
  { href: '/wallet', label: 'Wallet', d: 'M3 8a3 3 0 013-3h12a3 3 0 013 3v8a3 3 0 01-3 3H6a3 3 0 01-3-3zM3 10h18M16 14.5h2' },
];

export default function Nav() {
  const path = usePathname();
  return (
    <nav aria-label="Main">
      <div className="brand">
        <div className="mark">O</div>Opus
      </div>
      {items.map((i) => (
        <Link key={i.href} href={i.href} aria-current={path === i.href ? 'page' : undefined}>
          {icon(i.d)}
          {i.label}
        </Link>
      ))}
      <Link href="/login" className="out">
        {icon('M9 4H5v16h4M16 8l4 4-4 4M20 12H9')}
        Sign out
      </Link>
    </nav>
  );
}
