'use client';
// Connect wallet (WalletConnect): the buyer picks a wallet, and it is asked to send this invoice's exact amount to its address.
// EVM coins and tokens, and Solana (SOL, USDT, USDC). The project id (a free Reown id, variable NEXT_PUBLIC_WC_PROJECT_ID on the server) comes with the order; without it the button is not shown.
// EVM uses the ready-made wallet picker. Solana has none in its provider: it opens the connect link in a hidden frame and, if no wallet takes it, gives up so the pay screen can fall back to Open wallet.
// The Solana provider (@walletconnect/universal-provider) is already installed as part of the EVM one, which is built on it.
import { useState } from 'react';
import { useT } from '@/components/I18nProvider';
import { post } from '@/lib/api';
import { triggerHaptic } from '@/lib/haptics';
import { evmTx, WC_CHAINS } from '@/lib/wc-tx';

const SOL_CHAIN = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

const meta = () => ({ name: 'Vertexhash', description: 'Vertexhash', url: window.location.origin, icons: [`${window.location.origin}/icons/192`] });

// Small rotating circle (transform only), for a button that is working.
export function Spin() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" style={{ marginRight: 8, verticalAlign: '-3px' }}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
      </path>
    </svg>
  );
}

// Opens a link in a hidden frame (a scheme the webview does not know then fails inside the frame only, not as the page) and says whether a wallet took it:
// resolves true if the page lost focus or went hidden within `ms`, false if it is still in front (nothing opened).
export function tryOpen(url, ms = 1500) {
  return new Promise((resolve) => {
    let left = false;
    const gone = () => {
      left = true;
    };
    const evs = ['pagehide', 'blur', 'visibilitychange'];
    evs.forEach((e) => window.addEventListener(e, gone));
    try {
      const f = document.createElement('iframe');
      f.style.display = 'none';
      f.src = url;
      document.body.appendChild(f);
      setTimeout(() => f.remove(), 3000);
    } catch {}
    setTimeout(() => {
      evs.forEach((e) => window.removeEventListener(e, gone));
      resolve(left || document.hidden);
    }, ms);
  });
}

async function sendWith(tx, projectId, mark) {
  mark('loading');
  const { EthereumProvider } = await import('@walletconnect/ethereum-provider');
  mark('init');
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
    mark('connecting');
    await p.connect();
    const from = p.accounts[0];
    if (!from) throw new Error('no account');
    if (p.chainId !== tx.chainId) {
      mark('switching');
      try {
        // A wallet that never answers the switch must not block the payment request.
        await Promise.race([
          p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${tx.chainId.toString(16)}` }] }),
          new Promise((r) => setTimeout(r, 4000)),
        ]);
      } catch {}
    }
    mark('sending');
    const req = p.request({ method: 'eth_sendTransaction', params: [{ from, to: tx.to, value: tx.value, data: tx.data }] });
    req.catch(() => {});
    // The wallet app is behind the browser after connecting: open it so the request is in front of the buyer.
    const link = p.session?.peer?.metadata?.redirect?.native;
    if (link) setTimeout(() => tryOpen(link), 700);
    // Do not wait forever if the wallet never answers.
    return await Promise.race([req, new Promise((_, rej) => setTimeout(() => rej(new Error('no answer')), 120000))]);
  } finally {
    p.disconnect().catch(() => {});
  }
}

// Solana: connect, then the server writes the transfer for this order from the wallet's address (its blockhash lasts about a minute,
// so it is asked for only now) and the wallet signs and sends it. The connect link is opened in a hidden frame; if no wallet takes it, this throws.
async function sendSol(order) {
  const mod = await import('@walletconnect/universal-provider');
  const Provider = mod.default?.init ? mod.default : mod.UniversalProvider;
  const p = await Provider.init({ projectId: order.wc, metadata: meta() });
  let giveUp;
  const gone = new Promise((_, rej) => {
    giveUp = rej;
  });
  gone.catch(() => {});
  p.on('display_uri', (uri) => {
    tryOpen(uri).then((ok) => {
      if (!ok) giveUp(new Error('no wallet'));
    });
  });
  if (p.session) await p.disconnect().catch(() => {});
  try {
    const c = p.connect({ namespaces: { solana: { chains: [SOL_CHAIN], methods: ['solana_signAndSendTransaction', 'solana_signTransaction'], events: [] } } });
    c.catch(() => {});
    await Promise.race([c, gone]);
    const from = p.session?.namespaces?.solana?.accounts?.[0]?.split(':')[2];
    if (!from) throw new Error('no account');
    const { tx } = await post('/api/orders/sol-tx', { id: order.id, from });
    if (!tx) throw new Error('no transaction');
    return await p.request({ method: 'solana_signAndSendTransaction', params: { transaction: tx } }, SOL_CHAIN);
  } finally {
    p.disconnect().catch(() => {});
  }
}

// `onFail(auto)`: auto is true on Solana, where the pay screen goes on by itself to Open wallet.
export function ConnectBtn({ order, show, onFail }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(''); // DEBUG: which step the connect is on
  const evm = order.wc ? evmTx(order.uri) : null;
  const sol = !!order.wc && order.network === 'sol' && !!order.id;
  if (!evm && !sol) return null;
  const go = async () => {
    if (busy) return;
    triggerHaptic('selection');
    setBusy(true);
    let ok = false;
    let at = '';
    let why = '';
    const mark = (s) => {
      at = s;
      setStep(s);
    };
    try {
      if (evm) await sendWith(evm, order.wc, mark);
      else await sendSol(order);
      ok = true;
    } catch (e) {
      why = String(e?.message || e?.code || e || '').slice(0, 80); // DEBUG
    }
    setBusy(false);
    setStep('');
    if (ok) {
      show(t('pay.sent'));
      return;
    }
    if (evm) show(`${t('pay.notSent')} (${at}: ${why})`); // DEBUG: remove the brackets later
    if (onFail) onFail(!evm);
  };
  return (
    <button type="button" className="pct-btn" style={{ padding: '0 12px' }} disabled={busy} onClick={go}>
      {busy && <Spin />}
      {t('pay.connect')}
      {busy && step ? ` · ${step}` : ''}
    </button>
  );
}
