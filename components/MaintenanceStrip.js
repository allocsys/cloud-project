'use client';
// When the Worker answers maintenance, the app reloads once (after 1-4 s, so visitors do not all arrive together) and the Worker shows
// its full maintenance page, which brings the person back by itself. At most one reload per 2 minutes per tab: if the app is up again but
// still says maintenance, this slim bar shows instead and checks /api/health once a minute. No quick retries, no heavy requests.
import { useEffect, useState } from 'react';
import { useMaintenance, markUp } from '@/lib/api';
import { useT } from '@/components/I18nProvider';
import { everyVisible } from '@/lib/visible';

const KEY = 'vtx-maint-reload';
const GAP = 120000;

export default function MaintenanceStrip() {
  const t = useT();
  const down = useMaintenance();
  const [bar, setBar] = useState(false);
  useEffect(() => {
    if (!down) {
      setBar(false);
      return undefined;
    }
    let ok = false;
    try {
      const last = Number(sessionStorage.getItem(KEY)) || 0;
      if (Date.now() - last > GAP) {
        sessionStorage.setItem(KEY, String(Date.now()));
        ok = true;
      }
    } catch {}
    if (ok) {
      const id = setTimeout(() => window.location.reload(), 1000 + Math.random() * 3000);
      return () => clearTimeout(id);
    }
    setBar(true);
    return everyVisible(() => {
      fetch('/api/health', { cache: 'no-store' })
        .then((r) => {
          if (r.ok) markUp();
        })
        .catch(() => {});
    }, 60000);
  }, [down]);
  if (!down || !bar) return null;
  return (
    <div
      role="status"
      style={{
        margin: '0 0 12px',
        padding: '10px 14px',
        border: '1px solid var(--gold)',
        borderRadius: 12,
        fontSize: 14,
        textAlign: 'center',
      }}
    >
      {t('err.maint')}
    </div>
  );
}
