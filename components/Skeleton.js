'use client';
import { useEffect, useState } from 'react';

// Loading helpers. A screen with no data at all yet (a first-ever start, nothing saved on the phone) draws itself with placeholder
// data (lib/placeholder.js) and the "ld" class (app/globals.css), so the loading screen is the real layout and cannot drift from it.
// Once any data has been seen, the saved copy fills the screen at once (lib/api.js) and none of this is needed.

// True while `pending` holds, but only for `ms`: if the answer never comes, the screen falls back to what it showed before
// instead of shimmering for ever.
export function useWaiting(pending, ms = 6000) {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!pending) {
      setLate(false);
      return undefined;
    }
    const t = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(t);
  }, [pending, ms]);
  return pending && !late;
}
