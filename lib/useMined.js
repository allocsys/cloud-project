'use client';
import { useEffect, useRef, useState } from 'react';
import { BTC_USD } from '@/lib/data';

export { BTC_USD };

const SAT = 1e-8;

// Simulated live earnings. Replace with your API or websocket.
// Pass the combined daily USD of the online miners: a share lands about every 30 seconds and grows with the rate.
// No miners online (0) means no shares. Without an argument it runs at the old placeholder pace (~$2.30/day).
// Pass `base` (BTC from the server) to get `mined` = base + what the feed added since the page opened.
// `gain` is just the part added since the page opened.
// Pass `asOf` (server time in ms of the `base` figure) to make `gain` deterministic instead of random: the online daily
// rate times the time since asOf (capped at one day). Every page that uses the same asOf rate shows the same number.
// The shares list stays a simulated feed either way.
export function useMinedFeed(dailyUsd, base = 0, asOf = null) {
  const rate = dailyUsd === undefined ? 2.3 : dailyUsd;
  const live = rate > 0;
  const per = Math.max(1, Math.round(rate / BTC_USD / SAT / 2880));
  const [gain, setGain] = useState(0);
  const [shares, setShares] = useState([]);
  const nextId = useRef(1);

  useEffect(() => {
    if (!live) {
      setShares([]);
      return undefined;
    }
    const seedAt = Date.now();
    setShares([
      { id: -1, sats: per, at: seedAt - 4000 },
      { id: -2, sats: per, at: seedAt - 9500 },
      { id: -3, sats: per * 2, at: seedAt - 15000 },
    ]);

    let timer;
    const land = () => {
      const sats = per + (Math.random() < 0.15 ? Math.max(1, Math.round(per / 2)) : 0);
      setGain((m) => m + sats * SAT);
      setShares((s) => [{ id: nextId.current++, sats, at: Date.now() }, ...s].slice(0, 6));
      timer = setTimeout(land, 20000 + Math.random() * 18000);
    };
    timer = setTimeout(land, 2500);
    return () => clearTimeout(timer);
  }, [live, per]);

  const timed = asOf != null;
  const [clock, setClock] = useState(null);
  useEffect(() => {
    if (!timed || !live) return undefined;
    setClock(Date.now());
    const t = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(t);
  }, [timed, live, asOf]);
  const drift = timed && live && clock != null ? (Math.min(86400000, Math.max(0, clock - asOf)) / 86400000) * (rate / BTC_USD) : 0;
  const g = timed ? drift : gain;

  return { mined: base + g, gain: g, shares };
}

export function useMined() {
  return useMinedFeed().gain;
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
