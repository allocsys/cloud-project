'use client';
// Connect wallet (WalletConnect): the buyer picks a wallet, and it is asked to send this invoice's exact amount to its address.
// EVM coins and tokens, and Solana (SOL, USDT, USDC). The project id (a free Reown id, variable NEXT_PUBLIC_WC_PROJECT_ID on the server) comes with the order; without it the button is not shown.
// EVM works in two taps: Connect wallet only connects (no payment request), then the same button becomes Send payment and asks the connected wallet for the transfer.
// The EVM connection lives in components/WalletProvider.js (shared with the header pill), so a wallet connected there goes straight to Send payment.
// Solana has no wallet picker in its provider: it opens the connect link in a hidden frame and, if no wallet takes it, gives up so the pay screen can fall back to Open wallet.
// The Solana provider (@walletconnect/universal-provider) is already installed as part of the EVM one, which is built on it.
import { useState } from 'react';
import { useT } from '@/components/I18nProvider';
import { useWallet } from '@/components/WalletProvider';
import { post } from '@/lib/api';
import { triggerHaptic } from '@/lib/haptics';
import { evmTx } from '@/lib/wc-tx';

const SOL_CHAIN = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

// Invoices this browser already sent a payment for (last 30), so 'Payment sent' survives a page reload.
const PAID_KEY = 'vtx-paid';
const wasSent = (k) => {
  try {
    return !!k && JSON.parse(localStorage.getItem(PAID_KEY) || '[]').includes(k);
  } catch {
    return false;
  }
};
const markSent = (k) => {
  try {
    const a = JSON.parse(localStorage.getItem(PAID_KEY) || '[]').filter((x) => x !== k);
    a.push(k);
    localStorage.setItem(PAID_KEY, JSON.stringify(a.slice(-30)));
  } catch {}
};

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
  const w = useWallet();
  const [busy, setBusy] = useState(false);
  const [sentFor, setSentFor] = useState(''); // the invoice this wallet already sent a payment for (also kept in localStorage)
  const key = String(order.id || order.uri || '');
  const evm = w && order.wc ? evmTx(order.uri) : null;
  const sol = !!order.wc && order.network === 'sol' && !!order.id;
  if (!evm && !sol) return null;
  const acct = evm ? w.acct : '';
  const go = async () => {
    if (busy || (evm && w.busy)) return;
    triggerHaptic('selection');
    setBusy(true);
    let ok = false;
    let why = '';
    const mark = () => {};
    try {
      if (evm && !w.acct) {
        await w.connect({ chainId: evm.chainId, projectId: order.wc, mark });
        setBusy(false);
        return;
      }
      if (evm) {
        await w.send(evm, mark, tryOpen);
      } else {
        await sendSol(order);
      }
      ok = true;
    } catch (e) {
      why = String(e?.message || e?.code || e || '').slice(0, 80);
    }
    setBusy(false);
    // A wallet that never answered is likely a dead session: drop it so the next try starts clean.
    if (evm && !ok && /no answer/.test(why)) w.disconnect();
    if (ok) {
      setSentFor(key);
      markSent(key);
      show(t('pay.sent'));
      return;
    }
    if (evm) show(t('pay.notSent'));
    if (onFail) onFail(!evm);
  };
  const short = acct ? `${acct.slice(0, 6)}\u2026${acct.slice(-4)}` : '';
  const working = busy || (evm && w.busy);
  if (key && (sentFor === key || wasSent(key))) {
    return (
      <button type="button" className="pct-btn" style={{ padding: '0 12px' }} disabled>
        <Spin />
        {t('pay.sentBtn')}
      </button>
    );
  }
  return (
    <button type="button" className="pct-btn" style={{ padding: '0 12px' }} disabled={working} onClick={go}>
      {working && <Spin />}
      {acct ? `${t('pay.sendNow')}${working ? '' : ` \u00b7 ${short}`}` : t('pay.connect')}
    </button>
  );
}
