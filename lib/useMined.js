'use client';
import { useEffect, useState } from 'react';

export const BTC_USD = 67400;
export const START = 0.0018472;

// Simulated live earnings. Replace with your API or websocket.
export function useMined() {
  const [mined, setMined] = useState(START);
  useEffect(() => {
    const t = setInterval(() => setMined((m) => m + 0.00000011), 1500);
    return () => clearInterval(t);
  }, []);
  return mined;
}
