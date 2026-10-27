'use client';
// Connect wallet (WalletConnect): the buyer picks a wallet, and it is asked to send this invoice's exact amount to its address.
// EVM coins and tokens, and Solana (SOL, USDT, USDC). The project id (a free Reown id, variable NEXT_PUBLIC_WC_PROJECT_ID on the server) comes with the order; without it the button is not shown.
// EVM uses the ready-made wallet picker. Solana has none in its provider, so a small panel shows the connect link as a QR code, with copy and open buttons.
// The Solana provider (@walletconnect/universal-provider) is already installed as part of the EVM one, which is built on it.
import { useState } from 'react';
import { useT } from '@/components/I18nProvider';
import { Qr } from '@/components/Qr';
import { post } from '@/lib/api';
import { triggerHaptic } from '@/lib/haptics';
import { evmTx, WC_CHAINS } from '@/lib/wc-tx';

const SOL_CHAIN = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

const meta = () => ({ name: 'Opus Cloud Mining', description: 'Opus Cloud Mining', url: window.location.origin, icons: [`${window.location.origin}/icons/192`] });

async function sendWith(tx, projectId) {
  const { EthereumProvider } = await import('@walletconnect/ethereum-provider');
  const p = await EthereumProvider.init({
    projectId,
    chains: [tx.chainId],
    optionalChains: WC_CHAINS,
    showQrModal: true,
    metadata: meta(),
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

// Solana: connect, then the server writes the transfer for this order from the wallet's address (its blockhash lasts about a minute,
// so it is asked for only now) and the wallet signs and sends it. `onUri` gets the connect link to show.
async function sendSol(order, onUri) {
  const mod = await import('@walletconnect/universal-provider');
  const Provider = mod.default?.init ? mod.default : mod.UniversalProvider;
  const p = await Provider.init({ projectId: order.wc, metadata: meta() });
  p.on('display_uri', onUri);
  if (p.session) await p.disconnect().catch(() => {});
  try {
    await p.connect({ namespaces: { solana: { chains: [SOL_CHAIN], methods: ['solana_signAndSendTransaction', 'solana_signTransaction'], events: [] } } });
    const from = p.session?.namespaces?.solana?.accounts?.[0]?.split(':')[2];
    if (!from) throw new Error('no account');
    const { tx } = await post('/api/orders/sol-tx', { id: order.id, from });
    if (!tx) throw new Error('no transaction');
    return await p.request({ method: 'solana_signAndSendTransaction', params: { transaction: tx } }, SOL_CHAIN);
  } finally {
    p.disconnect().catch(() => {});
  }
}

export function ConnectBtn({ order, show }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [uri, setUri] = useState('');
  const evm = order.wc ? evmTx(order.uri) : null;
  const sol = !!order.wc && order.network === 'sol' && !!order.id;
  if (!evm && !sol) return null;
  const go = async () => {
    if (busy) return;
    triggerHaptic('selection');
    setBusy(true);
    setUri('');
    try {
      if (evm) await sendWith(evm, order.wc);
      else await sendSol(order, setUri);
      show(t('pay.sent'));
    } catch {
      show(t('pay.notSent'));
    } finally {
      setUri('');
      setBusy(false);
    }
  };
  const copyLink = () => {
    triggerHaptic('success');
    try {
      const pr = navigator.clipboard?.writeText(uri);
      if (pr && pr.catch) pr.catch(() => {});
    } catch {}
    show(t('wal.copied'));
  };
  return (
    <>
      <button type="button" className="pct-btn" style={{ padding: '0 12px' }} disabled={busy} onClick={go}>
        {t('pay.connect')}
      </button>
      {uri && (
        <div style={{ flexBasis: '100%' }}>
          <small style={{ display: 'block' }}>{t('pay.scanWc')}</small>
          <Qr value={uri} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            <a className="pct-btn" href={uri} style={{ padding: '0 12px', display: 'inline-flex', alignItems: 'center' }}>{t('plans.openWallet')}</a>
            <button type="button" className="pct-btn" style={{ padding: '0 12px' }} onClick={copyLink}>{t('pay.copyLink')}</button>
          </div>
        </div>
      )}
    </>
  );
}
