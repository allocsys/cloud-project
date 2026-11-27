'use client';
import { useRef } from 'react';
import { account } from '@/lib/data';
import { useToast } from '@/components/Toast';
import { triggerHaptic } from '@/components/haptics';
import { post, useApi } from '@/components/api';
import { useT } from '@/components/I18nProvider';
import { useWaiting } from '@/components/Skeleton';
import { SubHead, Switch } from '@/components/SettingsKit';

export default function NotificationSettings() {
  const t = useT();
  const [toast, show] = useToast();
  const { data: sd, mutate: mutateSettings, refresh: refreshSettings } = useApi('/api/settings', { ttl: 0 });
  const alerts = sd?.alerts || account.alerts;
  const waitSd = useWaiting(!sd);

  // The switch moves at once; if saving fails it goes back and says so.
  // Taps can come faster than the answers: each one builds on the latest switch state (not the screen's last render), and the saves go
  // one after another, so a slow answer can never undo a newer tap. A failed save puts the screen back to what the server has.
  const alertWant = useRef(null); // the switch state after the latest tap, until its save is done
  const alertQ = useRef(Promise.resolve());
  const alertBad = useRef(false); // a save in this run of taps failed
  function flipAlert(key) {
    triggerHaptic('selection');
    const base = alertWant.current || alerts;
    const want = { ...base, [key]: !base[key] };
    alertWant.current = want;
    mutateSettings({ ...(sd || {}), alerts: want });
    alertQ.current = alertQ.current.then(async () => {
      let res = null;
      try {
        res = await post('/api/settings', { alerts: { [key]: want[key] } });
      } catch (err) {
        triggerHaptic('error');
        alertBad.current = true;
        show(err.status ? err.message : t('common.noConnection'));
      }
      if (alertWant.current !== want) return; // a newer tap is still waiting: its own save ends this
      alertWant.current = null;
      if (res && !alertBad.current) mutateSettings(res);
      else refreshSettings().catch(() => {});
      alertBad.current = false;
    });
  }

  return (
    <>
      <SubHead title={t('set.notifs')} />
      <div className={waitSd ? 'grid wal ld' : 'grid wal'} aria-busy={waitSd || undefined} style={{ alignItems: 'start' }}>
        <div className="card">
          {[
            ['payouts', 'set.alPayouts'],
            ['withdrawals', 'set.alWd'],
            ['news', 'set.alNews'],
          ].map(([key, title], i) => (
            <div key={key} className="row" style={i ? undefined : { borderTop: 0 }}>
              <div className="set-t">{t(title)}</div>
              <Switch on={alerts[key]} onChange={() => flipAlert(key)} label={t(title)} />
            </div>
          ))}
        </div>
      </div>
      {toast}
    </>
  );
}
