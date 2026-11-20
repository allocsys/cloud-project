'use client';
// A slim bar while the Worker answers maintenance. Cached data stays on screen. It checks /api/health every 15 s and hides itself when the app is back.
import { useEffect } from 'react';
import { useMaintenance, markUp } from '@/lib/api';
import { useT } from '@/components/I18nProvider';
import { everyVisible } from '@/lib/visible';

export default function MaintenanceStrip() {
  const t = useT();
  const down = useMaintenance();
  useEffect(() => {
    if (!down) return undefined;
    return everyVisible(() => {
      fetch('/api/health', { cache: 'no-store' })
        .then((r) => {
          if (r.ok) markUp();
        })
        .catch(() => {});
    }, 15000);
  }, [down]);
  if (!down) return null;
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
