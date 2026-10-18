'use client';
import { useEffect, useRef, useState } from 'react';
import { BTC_USD, START_BTC } from '@/lib/data';

export { BTC_USD };

// Balance if you stopped reading the page right now: 0.00174184 BTC.
export const START = START_BTC;
const SAT = 1e-8;

// Simulated live earnings. Replace with your API or websocket.
// At the placeholder pace of ~$2.30/day (115 TH/s) a 1-sat share lands roughly every 30 seconds.
export function useMinedFeed() {
  const [mined, setMined] = useState(START);
  const [shares, setShares] = useState([]);
  const nextId = useRef(1);

  useEffect(() => {
    const seedAt = Date.now();
    setShares([
      { id: -1, sats: 1, at: seedAt - 4000 },
      { id: -2, sats: 1, at: seedAt - 9500 },
      { id: -3, sats: 2, at: seedAt - 15000 },
    ]);

    let timer;
    const land = () => {
      const sats = Math.random() < 0.15 ? 2 : 1;
      setMined((m) => m + sats * SAT);
      setShares((s) => [{ id: nextId.current++, sats, at: Date.now() }, ...s].slice(0, 6));
      timer = setTimeout(land, 20000 + Math.random() * 18000);
    };
    timer = setTimeout(land, 2500);
    return () => clearTimeout(timer);
  }, []);

  return { mined, shares };
}

export function useMined() {
  return useMinedFeed().mined;
}

// Re-renders once per interval so relative times ("4s ago") stay fresh.
export function useNow(interval = 1000) {
  const [now, setNow] = useState(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(t);
  }, [interval]);
  return now;
}

export function formatBtc(n, digits = 8) {
  return n.toFixed(digits);
}

export function formatUsd(n) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
