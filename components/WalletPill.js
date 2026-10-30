'use client';
// The small wallet button in the header, next to the bell: 'Connect', then the short address. Tap the address once to get Disconnect, tap again to disconnect.
// `compact` = round icon only (the Earnings bar is tight).
import { useEffect, useState } from 'react';
import { useT } from '@/components/I18nProvider';
import { useWallet } from '@/components/WalletProvider';
import { triggerHaptic } from '@/lib/haptics';

const WALLET = 'M3 7a2 2 0 012-2h13v3M3 7v10a2 2 0 002 2h15V8H5a2 2 0 01-2-1zM16 13.5h2';
const CROSS = 'M6 6l12 12M18 6L6 18';

export default function WalletPill({ compact = false }) {
  const t = useT();
  const w = useWallet();
  const [ask, setAsk] = useState(false);
  useEffect(() => {
    if (!ask) return undefined;
    const id = setTimeout(() => setAsk(false), 3000);
    return () => clearTimeout(id);
  }, [ask]);
  if (!w || (!w.enabled && !w.acct)) return null;
  const short = w.acct ? `${w.acct.slice(0, 4)}\u2026${w.acct.slice(-4)}` : '';
  const label = w.acct ? (ask ? t('wp.disconnect') : short) : t('wp.connect');
  const tap = async () => {
    if (w.busy) return;
    triggerHaptic('selection');
    if (w.acct) {
      if (!ask) {
        setAsk(true);
        return;
      }
      setAsk(false);
      w.disconnect();
      return;
    }
    try {
      await w.connect();
    } catch {}
  };
  const icon = w.busy ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M12 3a9 9 0 0 1 9 9" strokeWidth="3">
        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
      </path>
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={ask ? CROSS : WALLET} />
    </svg>
  );
  if (compact) {
    return (
      <button type="button" className="bell eh-walc" aria-label={w.acct ? (ask ? t('wp.disconnect') : short) : t('wp.connect')} disabled={w.busy} onClick={tap}>
        {icon}
        {w.acct && !ask && <i />}
      </button>
    );
  }
  return (
    <button type="button" className="eh-wal" disabled={w.busy} onClick={tap}>
      {icon}
      {w.acct && !ask && <i aria-hidden="true" />}
      <span>{label}</span>
    </button>
  );
}
