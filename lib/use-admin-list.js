'use client';
// One admin list (orders, withdrawals or refunds) read a page at a time: GET {url}?list=kind&filter=open|all&offset=&limit=.
// Rows are only fetched while `on` is true (the tab is open). `stamp` changes when the screen reloads after an action:
// the list is then read again from the top, as long as it already was, so a reload does not drop the pages already shown.
import { useCallback, useEffect, useRef, useState } from 'react';

export const PAGE = 20;
const MAX = 200; // the server's cap on one read

export default function useAdminList(url, kind, filter, on, stamp) {
  const [s, setS] = useState({ rows: [], shown: 0, ready: false, err: '' });
  const [busy, setBusy] = useState(false);
  const have = useRef(0); // rows on screen
  const key = useRef('');
  const seq = useRef(0); // a newer read makes an older answer ignored

  const read = useCallback(async (offset, limit) => {
    const r = await fetch(`${url}?list=${kind}&filter=${filter}&offset=${offset}&limit=${limit}`, { cache: 'no-store' });
    let j = {};
    try {
      j = await r.json();
    } catch {}
    if (!r.ok || !j.ok) throw new Error(j.error || 'Cannot load the list.');
    return j;
  }, [url, kind, filter]);

  const first = useCallback(async () => {
    const id = ++seq.current;
    const k = `${kind}|${filter}`;
    const same = key.current === k;
    key.current = k;
    if (!same) {
      have.current = 0;
      setS({ rows: [], shown: 0, ready: false, err: '' });
    }
    try {
      const j = await read(0, Math.min(MAX, Math.max(PAGE, have.current)));
      if (id !== seq.current) return;
      have.current = j.rows.length;
      setS({ rows: j.rows, shown: j.shown, ready: true, err: '' });
    } catch (e) {
      if (id === seq.current) setS((p) => ({ ...p, ready: true, err: e.message }));
    }
  }, [read, kind, filter]);

  useEffect(() => {
    if (on) first();
  }, [on, first, stamp]);

  const more = useCallback(async () => {
    if (busy) return;
    const id = ++seq.current;
    setBusy(true);
    try {
      const j = await read(have.current, PAGE);
      if (id !== seq.current) return;
      setS((p) => {
        const seen = new Set(p.rows.map((x) => x.id));
        const rows = [...p.rows, ...j.rows.filter((x) => !seen.has(x.id))];
        have.current = rows.length;
        return { rows, shown: j.shown, ready: true, err: '' };
      });
    } catch (e) {
      if (id === seq.current) setS((p) => ({ ...p, err: e.message }));
    } finally {
      setBusy(false);
    }
  }, [busy, read]);

  return { ...s, busy, more, retry: first, left: Math.max(0, s.shown - s.rows.length) };
}
