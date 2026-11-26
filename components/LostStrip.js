'use client';
// One slim line when requests fail (no connection, timeout, server error). Screens waiting for their first answer keep their
// skeleton; this line says why, and a tap (or the connection coming back) fetches again. Gone at the first good answer.
// Maintenance has its own bar (MaintenanceStrip), so this one stays quiet then.
import { useEffect } from 'react';
import { useLost, useMaintenance, retryNow } from '@/components/api';
import { useT } from '@/components/I18nProvider';

export default function LostStrip() {
  const t = useT();
  const lost = useLost();
  const maint = useMaintenance();
  const show = lost && !maint;
  useEffect(() => {
    if (!show) return undefined;
    window.addEventListener('online', retryNow);
    return () => window.removeEventListener('online', retryNow);
  }, [show]);
  if (!show) return null;
  return (
    <button
      type="button"
      role="status"
      onClick={retryNow}
      style={{
        display: 'block',
        width: '100%',
        margin: '0 0 12px',
        padding: '10px 14px',
        border: '1px solid var(--gold)',
        borderRadius: 12,
        background: 'none',
        color: 'inherit',
        font: 'inherit',
        fontSize: 14,
        textAlign: 'center',
        cursor: 'pointer',
      }}
    >
      {t('common.noConnection')}
    </button>
  );
}
