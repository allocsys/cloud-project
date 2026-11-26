'use client';
import { useState } from 'react';
import { EnterCtx } from '@/components/Enter';

// A template remounts on every navigation, so the page entrance animation replays per route.
// It also hands each screen one marker per navigation (components/Enter.js), so a screen that mounts twice does not fade in twice.
export default function Template({ children }) {
  const [marker] = useState(() => ({ played: false }));
  return (
    <EnterCtx.Provider value={marker}>
      <div className="page">{children}</div>
    </EnterCtx.Provider>
  );
}
