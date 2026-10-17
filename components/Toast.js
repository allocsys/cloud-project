'use client';
import { useCallback, useState } from 'react';

export function useToast() {
  const [msg, setMsg] = useState('');
  const show = useCallback((m) => {
    setMsg(m);
    setTimeout(() => setMsg(''), 2200);
  }, []);
  const node = (
    <div id="toast" className={msg ? 'on' : ''} role="status">
      {msg}
    </div>
  );
  return [node, show];
}
