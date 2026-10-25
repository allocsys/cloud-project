'use client';
// Wraps what sits under the calculator on the landing page. The Boost card (inside the calculator section) and the winners bar pop in
// when their data arrives, which would push everything below them down. This keeps its place but stays hidden until both answers are in
// (or 1.5 seconds), so nothing visible moves. Same cache entries as BoostPromo and WinnersBar, so no extra requests.
import { useEffect, useState } from 'react';
import { useApi } from '@/lib/api';

export default function LandingTail({ children }) {
  const { data: cat } = useApi('/api/plans', { ttl: 60000 });
  const { data: win } = useApi('/api/boost/winners', { ttl: 30000 });
  const [wait, setWait] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setWait(false), 1500);
    return () => clearTimeout(t);
  }, []);
  const hide = cat && win ? false : wait;
  return <div style={{ display: 'contents', visibility: hide ? 'hidden' : undefined }}>{children}</div>;
}
