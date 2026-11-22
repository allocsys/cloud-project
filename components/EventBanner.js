'use client';
// The deposit bonus event on Home and on the landing page. `event` = { perUsd, price, endsAt } from lib/server/event.js liveEvent(),
// null when no event runs (then nothing shows). Same look on both: a gold outline, a gift icon, a short line.
import Link from 'next/link';
import { useLang } from '@/components/I18nProvider';
import { dayText } from '@/lib/i18n/notes';

const GOLD = '#F5A524';
const Gift = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke={GOLD} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: 'none' }}>
    <rect x="3" y="8" width="18" height="4" rx="1" />
    <path d="M12 8v13M5 12v8a1 1 0 001 1h12a1 1 0 001-1v-8M7.5 8a2.5 2.5 0 010-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 010 5" />
  </svg>
);

// Home: under the top bar. Opens the deposit screen.
export function HomeEvent({ event }) {
  const { t, lang } = useLang();
  if (!event) return null;
  return (
    <Link href="/wallet?tab=deposit" className="card" style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #e8b84a', background: 'rgba(232,184,74,.08)', padding: '10px 12px' }}>
      <Gift />
      <span style={{ flex: 1, minWidth: 0 }}>
        <b style={{ display: 'block', fontSize: 13 }}>{t('ev.title')}</b>
        <small className="mute" style={{ display: 'block', lineHeight: 1.4 }}>{t('wal.evBanner', { n: event.perUsd, p: event.price, d: dayText(event.endsAt, lang) })}</small>
      </span>
    </Link>
  );
}

// Landing page: a slim strip above the header. Signed-in users also get a Deposit link.
export function LandingEvent({ event, signedIn }) {
  const { t, lang } = useLang();
  if (!event) return null;
  const link = { flex: 'none', fontSize: 12, fontWeight: 500, color: GOLD, background: 'none', border: 0, padding: 0, cursor: 'pointer' };
  return (
    <div role="note" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 12px', padding: '8px 12px', borderRadius: 12, border: '1px solid #e8b84a', background: 'rgba(232,184,74,.12)' }}>
      <Gift />
      <span style={{ flex: 1, fontSize: 12, lineHeight: 1.4 }}>{t('ev.landing', { d: dayText(event.endsAt, lang) })}</span>
      {signedIn && <Link href="/wallet?tab=deposit" style={link}>{t('wal.deposit')}</Link>}
    </div>
  );
}
