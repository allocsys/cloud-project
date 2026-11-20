'use client';
// Connect wallet (WalletConnect): the buyer picks a wallet, and it is asked to send this invoice's exact amount to its address.
// EVM coins and USDT. The project id (a free Reown id, variable NEXT_PUBLIC_WC_PROJECT_ID on the server) comes with the order; without it the button is not shown.
// EVM works in two taps: Connect wallet only connects (no payment request), then the same button becomes Send payment and asks the connected wallet for the transfer.
// The EVM connection lives in components/WalletProvider.js (shared with the header pill), so a wallet connected there goes straight to Send payment.
// Inside Telegram (wc: links are blocked there) the same two taps work for TON invoices with Tonkeeper over TON Connect; EVM invoices have no Connect wallet there.
import { useRef, useState } from 'react';
import { useT } from '@/components/I18nProvider';
import { useWallet } from '@/components/WalletProvider';
import { triggerHaptic } from '@/lib/haptics';
import { tonTx } from '@/lib/ton-tx';
import { evmTx } from '@/lib/wc-tx';

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

// Which Connect wallet flow an invoice gets: 'evm', 'ton' (Telegram only) or null (no button, Open wallet and Copy address stay up front).
export function connectKind(order, w) {
  if (!w) return null;
  if (w.tg) return order.network === 'ton' && tonTx(order.uri) ? 'ton' : null;
  return order.wc && evmTx(order.uri) ? 'evm' : null;
}

// `onFail(auto)`: auto is always false now (the wallet connection is shared with the header pill, so the person decides what to do next).
export function ConnectBtn({ order, show, onFail }) {
  const t = useT();
  const w = useWallet();
  const [busy, setBusy] = useState(false);
  const [sentFor, setSentFor] = useState(''); // the invoice this wallet already sent a payment for (also kept in localStorage)
  const silent = useRef(0); // taps in a row that the wallet never answered
  const key = String(order.id || order.uri || '');
  const kind = connectKind(order, w);
  const evm = kind === 'evm' ? evmTx(order.uri) : null;
  const ton = kind === 'ton' ? tonTx(order.uri) : null;
  if (!kind) return null;
  const own = !!(evm || ton); // the wallet connection is shared with the header pill
  const acct = own ? w.acct : '';
  const go = async () => {
    if (busy || (own && w.busy)) return;
    triggerHaptic('selection');
    setBusy(true);
    let ok = false;
    let why = '';
    const mark = () => {};
    try {
      if (own && !w.acct) {
        await w.connect({ projectId: order.wc, mark });
        setBusy(false);
        return;
      }
      if (ton) {
        await w.sendTon(ton, mark, () => {
          setSentFor(key);
          markSent(key);
          show(t('pay.sent'));
        });
        silent.current = 0;
      } else if (evm) {
        // The wallet may answer after "no answer" (a person who approves a few minutes later): then the payment is sent after all.
        await w.send(evm, mark, tryOpen, () => {
          setSentFor(key);
          markSent(key);
          show(t('pay.sent'));
        });
        silent.current = 0;
      }
      ok = true;
    } catch (e) {
      why = String(e?.message || e?.code || e || '').slice(0, 80);
    }
    setBusy(false);
    // A wallet that never answered may still be asked: the request stays open (and a tap on Send again waits for that same one, it does not
    // send a second payment), and the session is kept so a late approval still counts. Only a wallet that stays silent twice in a row is
    // treated as a dead session and dropped, so the next try starts clean.
    if (own && !ok && /no answer/.test(why) && ++silent.current >= 2) {
      silent.current = 0;
      w.disconnect();
    }
    if (ok) {
      setSentFor(key);
      markSent(key);
      show(t('pay.sent'));
      return;
    }
    if (own) show(t('pay.notSent'));
    if (onFail) onFail(false);
  };
  const short = acct ? `${acct.slice(0, 6)}\u2026${acct.slice(-4)}` : '';
  const working = busy || (own && w.busy);
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
