'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '@/components/I18nProvider';

// The snackbar. Messages wait in line and show one after another (a payment or copy error is never replaced before it was seen).
// A message stays longer when it is longer, a tap on it or on the X closes it, and the same message again just stays a bit more.
const MIN_MS = 3500;
const MAX_MS = 7000;
const QUEUED_MS = 2200; // while others wait, each one stays this long at most
const stay = (m) => Math.min(MAX_MS, Math.max(MIN_MS, 1800 + String(m).length * 60));

export function useToast() {
  const t = useT();
  const [msg, setMsg] = useState('');
  const q = useRef([]); // messages waiting
  const cur = useRef(''); // the one on screen ('' = none)
  const timer = useRef(0);

  const next = useCallback(() => {
    clearTimeout(timer.current);
    const m = q.current.shift();
    if (m === undefined) {
      cur.current = '';
      setMsg('');
      return;
    }
    cur.current = m;
    setMsg(m);
    timer.current = setTimeout(next, q.current.length ? Math.min(stay(m), QUEUED_MS) : stay(m));
  }, []);

  const show = useCallback(
    (m) => {
      const s = String(m ?? '');
      if (!s) return;
      if (cur.current === s) {
        // The same message again: keep it up for another full time.
        clearTimeout(timer.current);
        timer.current = setTimeout(next, stay(s));
        return;
      }
      if (q.current.includes(s)) return;
      q.current.push(s);
      if (!cur.current) next();
      else {
        // Someone is waiting: the one on screen gives way sooner.
        clearTimeout(timer.current);
        timer.current = setTimeout(next, QUEUED_MS);
      }
    },
    [next],
  );

  useEffect(() => () => clearTimeout(timer.current), []);

  const node = (
    <div id="toast" className={msg ? 'on' : ''} role="status">
      <span>{msg}</span>
      <button type="button" className="toast-x" aria-label={t('common.close')} tabIndex={msg ? 0 : -1} onClick={next}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>
  );
  return [node, show];
}
