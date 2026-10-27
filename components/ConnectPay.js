'use client';
// Connect wallet (WalletConnect): the buyer picks a wallet, and it is asked to send this invoice's exact amount to its address.
// EVM coins and tokens only. Needs NEXT_PUBLIC_WC_PROJECT_ID (a free Reown project id); without it the button is not shown.
import { useState } from 'react';
import { useT } from '@/components/I18nProvider';
import { triggerHaptic } from '@/lib/haptics';
import { evmTx, WC_CHAINS } from '@/lib/wc-tx';

const PROJECT_ID = process.env.NEXT_PUBLIC_WC_PROJECT_ID || '';

async function sendWith(tx) {
  const { EthereumProvider } = await import('@walletconnect/ethereum-provider');
  const p = await EthereumProvider.init({
    projectId: PROJECT_ID,
    chains: [tx.chainId],
    optionalChains: WC_CHAINS,
    showQrModal: true,
    metadata: { name: 'Opus Cloud Mining', description: 'Opus Cloud Mining', url: window.location.origin, icons: [`${window.location.origin}/icons/192`] },
  });
  // A session left from an earlier payment could be on another chain or account: always start clean.
  if (p.session) await p.disconnect().catch(() => {});
  try {
    await p.connect();
    const from = p.accounts[0];
    if (!from) throw new Error('no account');
    if (p.chainId !== tx.chainId) {
      try {
        await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${tx.chainId.toString(16)}` }] });
      } catch {}
    }
    return await p.request({ method: 'eth_sendTransaction', params: [{ from, to: tx.to, value: tx.value, data: tx.data }] });
  } finally {
    p.disconnect().catch(() => {});
  }
}

export function ConnectBtn({ order, show }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const tx = PROJECT_ID ? evmTx(order.uri) : null;
  if (!tx) return null;
  const go = async () => {
    if (busy) return;
    triggerHaptic('selection');
    setBusy(true);
    try {
      await sendWith(tx);
      show(t('pay.sent'));
    } catch {
      show(t('pay.notSent'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className="pct-btn" style={{ padding: '0 12px' }} disabled={busy} onClick={go}>
      {t('pay.connect')}
    </button>
  );
}
