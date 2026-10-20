'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { triggerHaptic } from '@/lib/haptics';
import { signOut } from '@/lib/api';

// Opens the demo account. Any real session is dropped first, so the demo never opens inside someone's account.
export default function DemoButton({ className = 'btn ghost', children }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function go() {
    triggerHaptic('light');
    setBusy(true);
    try {
      await signOut();
      router.replace('/dashboard');
    } catch {
      setBusy(false);
    }
  }

  return (
    <button type="button" className={className} onClick={go} disabled={busy}>
      {busy ? 'Opening...' : children}
    </button>
  );
}
