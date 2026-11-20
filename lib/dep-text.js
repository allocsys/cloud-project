'use client';
// English texts of the deposit flow. Temporary: they move to the locale files once the Persian drafts are approved (then this file goes).
// A key that a locale already has wins; a missing one (translateClient returns the key itself) falls back to this dict.
import { useT } from '@/components/I18nProvider';

export const DEP_EN = {
  'dep.manual': 'Pay manually',
  'dep.checking': 'Checking device\u2026',
  'dep.envTg': 'Telegram',
  'dep.envSite': 'Site',
  'dep.envPwa': 'App',
  'dep.scan': 'Scan QR',
  'dep.pay': 'Pay {n}',
  'dep.connected': 'Wallet connected',
  'dep.back': 'Back',
  'dep.progress': 'Progress',
};

export function useDepT() {
  const t = useT();
  return (key, vars) => {
    const s = t(key, vars);
    if (s !== key || !DEP_EN[key]) return s;
    let out = DEP_EN[key];
    if (vars) for (const k of Object.keys(vars)) out = out.split(`{${k}}`).join(String(vars[k]));
    return out;
  };
}
