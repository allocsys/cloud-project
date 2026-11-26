'use client';
import { useEffect, useState } from 'react';

// Loading helpers. A screen with no data at all yet (a first-ever start, nothing saved on the phone) draws itself with placeholder
// data (components/placeholder.js) and the "ld" class (app/globals.css), so the loading screen is the real layout and cannot drift from it.
// Once any data has been seen, the saved copy fills the screen at once (components/api.js) and none of this is needed.

// True while `pending` holds. App screens wait for their answer as long as it takes: a sample or empty screen would look like
// "no miners" or a zero balance, so the skeleton stays and the connection strip (components/LostStrip.js) says when requests fail.
// Landing widgets pass `ms`: after that time they fall back to what they showed before instead of shimmering for ever.
export function useWaiting(pending, ms = Infinity) {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!pending) {
      setLate(false);
      return undefined;
    }
    if (!Number.isFinite(ms)) return undefined;
    const t = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(t);
  }, [pending, ms]);
  return pending && !late;
}
