'use client';
import { useEffect, useRef, useState } from 'react';
import { account } from '@/lib/data';
import { useToast } from '@/components/Toast';
import { triggerHaptic } from '@/components/haptics';
import { post, useApi } from '@/components/api';
import { useT } from '@/components/I18nProvider';
import { SOCIALS } from '@/lib/site';
import { useWaiting } from '@/components/Skeleton';
import { PH_ME } from '@/components/placeholder';
import { SubHead, Switch } from '@/components/SettingsKit';

export default function NotificationSettings() {
  const t = useT();
  const [toast, show] = useToast();
  const { data: sd, mutate: mutateSettings, refresh: refreshSettings } = useApi('/api/settings', { ttl: 0 });
  const alerts = sd?.alerts || account.alerts;
  const { data: meLive, refresh: refreshMe, quiet: quietMe } = useApi('/api/auth/me', { ttl: 60000 });
  const waitMe = useWaiting(!meLive);
  // Until the account answers, the page draws itself with placeholder data in the loading look (components/placeholder.js, .ld).
  const me = meLive || (waitMe ? PH_ME : undefined);
  // Telegram bot link (email accounts): bl = the bot link with a one-time code (valid 10 minutes) while the person is in Telegram.
  const [bl, setBl] = useState(null);
  const [blBusy, setBlBusy] = useState(false);
  // While the link is open, check now and then (and on return to this screen) whether the bot took the code.
  useEffect(() => {
    if (!bl) return undefined;
    if (me?.botLinked) {
      setBl(null);
      show(t('set.botDone'));
      return undefined;
    }
    // Every 4 s for the first minute, then every 10 s; quiet checks wait while the server is failing or busy.
    const tick = () => {
      if (!document.hidden) quietMe().catch(() => {});
    };
    let n = 0;
    let poll;
    const loop = () => {
      poll = setTimeout(() => {
        tick();
        n += 1;
        loop();
      }, n < 15 ? 4000 : 10000);
    };
    loop();
    const stop = setTimeout(() => setBl(null), 10 * 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearTimeout(poll);
      clearTimeout(stop);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [bl, me?.botLinked]);

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

  // Asks for a one-time code and opens the bot with it: one tap on Start in Telegram links the account.
  async function connectBot() {
    if (blBusy) return;
    triggerHaptic('light');
    setBlBusy(true);
    try {
      const r = await post('/api/account/bot-link', {});
      const url = `${SOCIALS.bot}?start=lnk_${r.code}`;
      triggerHaptic('success');
      setBl(url);
      const w = window.Telegram?.WebApp;
      if (w?.openTelegramLink) w.openTelegramLink(url);
      else window.open(url, '_blank', 'noopener'); // a blocked pop-up is fine: the Open Telegram button stays on screen
    } catch (err) {
      triggerHaptic('error');
      show(err.status ? err.message : t('common.noConnection'));
    } finally {
      setBlBusy(false);
    }
  }

  async function disconnectBot() {
    if (blBusy) return;
    triggerHaptic('light');
    setBlBusy(true);
    try {
      await post('/api/account/bot-unlink', {});
      triggerHaptic('success');
      setBl(null);
      refreshMe();
      show(t('set.botGone'));
    } catch (err) {
      triggerHaptic('error');
      show(err.status ? err.message : t('common.noConnection'));
    } finally {
      setBlBusy(false);
    }
  }

  return (
    <>
      <SubHead title={t('set.notifs')} />
      <div className={waitMe ? 'grid wal ld' : 'grid wal'} aria-busy={waitMe || undefined} style={{ alignItems: 'start' }}>
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
          {me?.email && (
            <>
              <div className="row">
                <div>
                  <div style={{ fontWeight: 500, fontSize: '13.5px' }}>{t('set.bot')}</div>
                  <small>{me.botLinked ? t('set.botOn') : t('set.botSub')}</small>
                </div>
                {me.telegram ? (
                  <span className="badge ok">{t('set.botOn')}</span>
                ) : me.botLinked ? (
                  <button className="btn ghost" type="button" disabled={blBusy} onClick={disconnectBot}>{t('set.botOff')}</button>
                ) : bl ? (
                  <a className="btn ghost" href={bl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', textAlign: 'center', textDecoration: 'none' }}>{t('set.botOpen')}</a>
                ) : (
                  <button className="btn ghost" type="button" disabled={blBusy} onClick={connectBot}>{t('set.botConnect')}</button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      {toast}
    </>
  );
}
