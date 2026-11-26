'use client';
import PageHead from '@/components/PageHead';
import { account } from '@/lib/data';
import { useToast } from '@/components/Toast';
import { triggerHaptic } from '@/lib/haptics';
import { signOut, useApi, useBundle } from '@/lib/api';
import { useT, useLang } from '@/components/I18nProvider';
import { LANG_META } from '@/lib/i18n/meta';
import { useAppVersion } from '@/lib/app-version';
import { useWaiting } from '@/components/Skeleton';
import { PH_ME } from '@/lib/placeholder';
import { LevelBadge, NavRow } from '@/components/SettingsKit';

const KYC = {
  none: { label: 'set.notVerified', cls: 'warn', cta: 'set.verify' },
  pending: { label: 'set.inReview', cls: '', cta: null },
  verified: { label: 'kyc.verified', cls: 'ok', cta: null },
};

export default function Settings() {
  const t = useT();
  const { lang } = useLang();
  const [toast, show] = useToast();
  useBundle('/api/bundle/settings', ['/api/settings', '/api/kyc', '/api/auth/me'], (b) => [
    ['/api/settings', b.settings],
    ['/api/kyc', b.kyc],
    ['/api/auth/me', b.me],
  ]);
  const { data: sd } = useApi('/api/settings', { ttl: 0 });
  const alerts = sd?.alerts || account.alerts;
  const alertsOn = ['payouts', 'withdrawals', 'news'].filter((k) => alerts[k]).length;
  const { data: kd } = useApi('/api/kyc', { ttl: 30000 });
  const kyc = KYC[kd ? kd.status : account.kyc] || KYC.none;
  const { data: meLive, refresh: refreshMe, quiet: quietMe } = useApi('/api/auth/me', { ttl: 60000 });
  const waitMe = useWaiting(!meLive);
  // Until the account answers, the page draws itself with placeholder data in the loading look (lib/placeholder.js, .ld).
  const me = meLive || (waitMe ? PH_ME : undefined);
  const version = useAppVersion();

  // The big line is the Telegram name or the email; the small one says what kind of account it is.
  const name = me ? me.name || me.email || (me.demo ? t('set.demo') : t('set.tgAcc')) : account.email;
  const sub = me?.name ? me.email || t('set.tgAcc') : me?.email ? t('set.account') : '';
  const copyValue = me?.email || (me?.telegram ? me.id.slice(3) : '');

  async function copy() {
    triggerHaptic('light');
    try {
      await navigator.clipboard.writeText(copyValue);
      show(t('set.copied'));
    } catch {
      triggerHaptic('error');
    }
  }

  async function handleSignOut() {
    triggerHaptic('medium');
    await signOut();
    window.location.assign('/'); // a fresh load, so the home page shows the signed-out version
  }

  return (
    <>
      <PageHead title={t('nav.settings')} icon="settings" />
      <div className={waitMe ? 'grid wal ld' : 'grid wal'} aria-busy={waitMe || undefined} style={{ alignItems: 'start' }}>
        <div className="card set-who">
          <span className="set-av" aria-hidden="true">{Array.from(name)[0]?.toUpperCase()}</span>
          <div className="set-name">
            <b><bdi>{name}</bdi></b>
            {sub && <small><bdi>{sub}</bdi></small>}
          </div>
          {copyValue && (
            <button type="button" className="set-copy" aria-label={t('set.copy')} onClick={copy}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 9h11v11H9zM5 15H4V4h11v1" />
              </svg>
            </button>
          )}
        </div>
        <div className="card">
          <NavRow href="/settings/kyc" title={t('set.verification')}>
            <span className={`badge ${kyc.cls}`}>{t(kyc.label)}</span>
          </NavRow>
          <NavRow href="/settings/security" title={t('set.security')}>
            {me && <LevelBadge me={me} />}
          </NavRow>
          <NavRow href="/settings/notifications" title={t('set.notifs')}>
            <span>{alertsOn ? t('set.nOn', { n: alertsOn }) : t('set.allOff')}</span>
          </NavRow>
          <NavRow href="/settings/preferences" title={t('set.prefs')}>
            <span>{LANG_META[lang].name}</span>
          </NavRow>
          <NavRow href="/settings/help" title={t('set.help')} />
          {version && (
            <NavRow href="/settings/about" title={t('set.about')}>
              <span dir="ltr">{version}</span>
            </NavRow>
          )}
        </div>
        <button className="btn ghost" type="button" onClick={handleSignOut}>{t('nav.signOut')}</button>
      </div>
      {toast}
    </>
  );
}
