'use client';
// The sign-in sheet. It hovers above the page before sign-in (the landing page) and closes with the X, a tap on the
// backdrop, Escape or the back button. Wrap the page in <AuthSheetProvider> and open it with <AuthButton> or useAuthSheet().open().
// While open it owns one history entry (so back closes it instead of leaving the page). When the person signs in, the
// entry is replaced by the dashboard instead of being undone.
// Links that used to point at /login now open the sheet: /login redirects to /?auth=1 and keeps its query
// (ref, mode=signup, reset and email), which is read here once and then removed from the address bar.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthForm from '@/components/AuthForm';
import { useT } from '@/components/I18nProvider';
import { triggerHaptic } from '@/lib/haptics';

const Ctx = createContext(null);

export function useAuthSheet() {
  return (
    useContext(Ctx) || {
      // Outside a provider: go to the page that has the sheet.
      open: (mode) => window.location.assign(mode === 'signup' ? '/?auth=signup' : '/?auth=1'),
    }
  );
}

// A button that opens the sheet: mode 'signup' opens it on Create account, anything else on Sign in.
export function AuthButton({ mode = 'signin', className, children, onClick, ...rest }) {
  const { open } = useAuthSheet();
  return (
    <button
      type="button"
      className={className}
      onClick={(e) => {
        triggerHaptic('light');
        if (onClick) onClick(e);
        open(mode);
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

// Reads the sheet's request from the address once: an invite link, Get started, or an emailed reset link.
function parseQuery() {
  try {
    const q = new URLSearchParams(window.location.search);
    const t = (q.get('reset') || '').trim().slice(0, 100);
    const m = (q.get('email') || '').trim().slice(0, 120);
    const r = (q.get('ref') || '').trim().slice(0, 24);
    const a = q.get('auth');
    const mode = q.get('mode');
    if (r) localStorage.setItem('vtx-ref', r);
    let init = null;
    if (t && m) init = { reset: { token: t, email: m } };
    else if (r || mode === 'signup' || a === 'signup') init = { signup: true };
    else if (a) init = {};
    if (a || t || m || r || mode) window.history.replaceState(null, '', '/');
    return init;
  } catch {
    return null;
  }
}

export function AuthSheetProvider({ signedIn = false, showDemo = true, children }) {
  const router = useRouter();
  const t = useT();
  const [auth, setAuth] = useState(null); // null: closed. Otherwise how it opened: { signup } or { reset }
  const [n, setN] = useState(0); // a fresh form each time the sheet opens
  const leaving = useRef(false); // set when the sheet closes because the page is being left
  const card = useRef(null);
  const opener = useRef(null);
  const parsed = useRef(null); // null: the address has not been read yet. false: nothing was asked for.
  const isOpen = !!auth;

  const open = useCallback((mode) => {
    opener.current = document.activeElement;
    setN((x) => x + 1);
    setAuth({ signup: mode === 'signup' });
  }, []);

  const close = useCallback(() => {
    triggerHaptic('light');
    setAuth(null);
  }, []);

  // Signed in (or the demo was chosen): go on, and keep the history entry for the page we land on.
  const done = useCallback(
    (to) => {
      leaving.current = true;
      router.replace(to);
    },
    [router],
  );

  const leave = useCallback(() => {
    leaving.current = true;
  }, []);

  // A link to /login (an invite, Get started, a reset email) arrives as /?auth=...: open the sheet, after the splash has lifted.
  useEffect(() => {
    if (parsed.current === null) parsed.current = parseQuery() || false;
    const init = parsed.current;
    if (!init) return undefined;
    if (signedIn && !init.reset) return undefined; // already signed in: nothing to sign in to
    const show = () => {
      setN((x) => x + 1);
      setAuth(init);
    };
    if (window.__vtxSplash === 'on') {
      window.addEventListener('vtx-splash-done', show, { once: true });
      return () => window.removeEventListener('vtx-splash-done', show);
    }
    show();
    return undefined;
  }, [signedIn]);

  // While open: one history entry, Escape closes, the page behind does not scroll, focus moves in and comes back.
  useEffect(() => {
    if (!isOpen) return undefined;
    leaving.current = false;
    window.history.pushState({ vtxSheet: true }, '');
    let popped = false;
    const onPop = () => {
      popped = true;
      setAuth(null);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setAuth(null);
      }
    };
    window.addEventListener('popstate', onPop);
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    card.current?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      if (!popped && !leaving.current) window.history.back();
      try {
        if (!leaving.current) opener.current?.focus?.({ preventScroll: true });
      } catch {}
    };
  }, [isOpen]);

  const value = useMemo(() => ({ open }), [open]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {auth && (
        <div
          className="sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="auth-t"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="card" ref={card} tabIndex={-1} style={{ outline: 0 }}>
            <div className="grab" aria-hidden="true" />
            <button type="button" className="sheet-x" aria-label={t('common.close')} onClick={close}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
            <AuthForm key={n} init={auth} onDone={done} onLeave={leave} showDemo={showDemo} />
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
