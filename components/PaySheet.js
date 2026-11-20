'use client';
// An open crypto payment of a plan: PayBar is the collapsed line, PaySheet the bottom sheet it opens (exact amount, address, one main button,
// copy buttons, cancel). CoinTabs is the one-row coin picker (a second row of networks for USDT) used here and in the plan sheet.
import { useEffect, useRef, useState } from 'react';
import { PAY_ASSETS, PAY_NETS } from '@/lib/pay-coins';
import { triggerHaptic } from '@/lib/haptics';
import { useT } from '@/components/I18nProvider';
import { ConnectBtn, Spin, connectKind, tryOpen } from '@/components/ConnectPay';
import { useWallet } from '@/components/WalletProvider';
import { Qr } from '@/components/Qr';
import { useSheetBack } from '@/lib/nav';
import { fmtUsd } from '@/lib/data';

function copyText(text) {
  triggerHaptic('success');
  try {
    const p = navigator.clipboard?.writeText(text);
    if (p && p.catch) p.catch(() => {});
  } catch {}
}

// Seconds left until `at` (null without a valid time). Ticks once a second while the tab is visible, stops at zero.
function useLeft(at) {
  const end = at ? Date.parse(at) : NaN;
  const [now, setNow] = useState(() => Date.now());
  const live = Number.isFinite(end) && end > now;
  useEffect(() => {
    if (!live) return undefined;
    const tick = () => {
      if (!document.hidden) setNow(Date.now());
    };
    const id = setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [live]);
  return Number.isFinite(end) ? Math.max(0, Math.ceil((end - now) / 1000)) : null;
}

const fmtTime = (s) => `${s >= 3600 ? `${Math.floor(s / 3600)}:` : ''}${String(Math.floor((s % 3600) / 60)).padStart(s >= 3600 ? 2 : 1, '0')}:${String(s % 60).padStart(2, '0')}`;

// Equal segments on one line; the highlight slides to the chosen one.
function Seg({ items, value, onPick, label, disabled }) {
  const i = Math.max(0, items.findIndex((x) => x.id === value));
  return (
    <div className="seg" role="group" aria-label={label} style={{ '--n': items.length, '--i': i }}>
      <i aria-hidden="true" />
      {items.map((x) => (
        <button
          key={x.id}
          type="button"
          aria-pressed={x.id === value}
          disabled={disabled}
          onClick={() => {
            if (x.id === value) return;
            triggerHaptic('selection');
            onPick(x.id);
          }}
        >
          {x.label}
        </button>
      ))}
    </div>
  );
}

// value and onChange use { asset, net }.
export function CoinTabs({ value, onChange, disabled = false }) {
  const t = useT();
  const a = PAY_ASSETS[value.asset] || PAY_ASSETS.btc;
  return (
    <>
      <Seg
        label={t('wal.coin')}
        value={value.asset}
        disabled={disabled}
        items={Object.entries(PAY_ASSETS).map(([id, c]) => ({ id, label: c.sym }))}
        onPick={(id) => onChange({ asset: id, net: PAY_ASSETS[id].nets[0] })}
      />
      {a.nets.length > 1 && (
        <Seg
          label={t('wal.network')}
          value={value.net}
          disabled={disabled}
          items={a.nets.map((n) => ({ id: n, label: PAY_NETS[n] }))}
          onPick={(n) => onChange({ asset: value.asset, net: n })}
        />
      )}
    </>
  );
}

// The collapsed line: a pulsing dot, the time left, a chevron.
export function PayBar({ order, onOpen }) {
  const t = useT();
  const left = useLeft(order.expiresAt);
  const time = left === null ? '' : left === 0 ? t('pay.expired') : fmtTime(left);
  return (
    <button type="button" className="paybar" onClick={onOpen}>
      <span className="paydot" aria-hidden="true" />
      <span>
        <b>{t('plans.waiting')}</b>
        {time ? ` \u00b7 ${time}` : ''}
      </span>
      <span className="paychev" aria-hidden="true" />
    </button>
  );
}

// Amount, network, address and the QR toggle. Remounts (fades in) when the order changes.
function Details({ order }) {
  const t = useT();
  const [qr, setQr] = useState(false);
  const a = PAY_ASSETS[order.asset || 'btc'];
  const sym = a ? a.sym : 'BTC';
  const net = PAY_NETS[order.network || 'btc'] || '';
  return (
    <div className="unfold">
      <p className="fine" style={{ margin: '6px 0 2px' }}>{t('pay.sendExactly')}</p>
      <b style={{ display: 'block', fontSize: 26, lineHeight: 1.2, color: 'var(--gold2)', wordBreak: 'break-all', fontVariantNumeric: 'tabular-nums' }}>
        {order.amount} {sym}
      </b>
      {net && <small className="mute">{t('pay.onNet', { net })}</small>}
      <p className="fine" style={{ margin: '14px 0 4px' }}>{t('pay.to')}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="serial" style={{ flex: 1, minWidth: 0, fontSize: 13, wordBreak: 'break-all', userSelect: 'all' }}>{order.address}</span>
        <button
          type="button"
          className="pct-btn"
          aria-pressed={qr}
          aria-label={t('pay.qr')}
          style={{ width: 40, minWidth: 40, height: 40, padding: 0, flex: 'none' }}
          onClick={() => {
            triggerHaptic('selection');
            setQr(!qr);
          }}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
            <path d="M14 14h2v2h-2zM19 14h2v2h-2zM14 19h2v2h-2zM19 19h2v2h-2z" />
          </svg>
        </button>
      </div>
      {qr && (
        <div className="unfold">
          <Qr value={order.uri || order.address} />
        </div>
      )}
    </div>
  );
}

// The pinned part: one main button (Connect wallet when it fits, else Open wallet), Copy address and Copy amount, Cancel order.
function Actions({ order, show, onCancel }) {
  const t = useT();
  const w = useWallet();
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);
  const kind = connectKind(order, w);
  // Telegram's webview cannot hand a link to a wallet, except the TON one that opens in the browser.
  const canOpen = !!order.uri && /^[a-z][a-z0-9+.-]*:/i.test(order.uri) && !(w.tg && order.network !== 'ton');
  async function openWallet() {
    if (opening) return;
    const tgApp = window.Telegram?.WebApp;
    if (order.network === 'ton' && tgApp?.initData && tgApp.openLink && /^ton:\/\/transfer\//.test(order.uri || '')) {
      tgApp.openLink(order.uri.replace(/^ton:\/\//, 'https://app.tonkeeper.com/'));
      return;
    }
    setOpening(true);
    const ok = await tryOpen(order.uri);
    setOpening(false);
    if (ok) return;
    copyText(order.address);
    show(t('pay.noWallet'));
  }
  const copy = (text) => {
    copyText(text);
    show(t('wal.copied'));
  };
  return (
    <>
      {kind && <ConnectBtn big order={order} show={show} onFail={() => setFailed(true)} />}
      {canOpen && (!kind || failed) && (
        <button type="button" className={kind ? 'btn ghost' : 'btn'} onClick={openWallet} disabled={opening}>
          {opening && <Spin />}
          {t('plans.openWallet')}
        </button>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn ghost" style={{ flex: 1 }} onClick={() => copy(order.address)}>{t('pay.copyAddr')}</button>
        <button type="button" className="btn ghost" style={{ flex: 1 }} onClick={() => copy(String(order.amount))}>{t('pay.copyAmt')}</button>
      </div>
      <button type="button" className="linkbtn" style={{ alignSelf: 'center', color: 'var(--red)' }} onClick={onCancel}>{t('pay.cancelOrder')}</button>
    </>
  );
}

// `busy`: a coin change is under way (the last order stays on screen, dimmed). `canSwitch`: this order can be remade in another coin.
export function PaySheet({ order, show, busy = false, canSwitch = false, onClose, onCancel, onSwitch }) {
  const t = useT();
  const ref = useRef(null);
  const startY = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [dragY, setDragY] = useState(0);
  const [target, setTarget] = useState(null); // the coin just tapped: the highlight moves at once, before the new order arrives
  const left = useLeft(order.expiresAt);
  const a = PAY_ASSETS[order.asset || 'btc'] || PAY_ASSETS.btc;
  const coin = target || { asset: order.asset || 'btc', net: order.network || a.nets[0] };

  useSheetBack(true, onClose);

  // Escape closes, Tab stays inside, the page behind does not scroll.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
      } else if (e.key === 'Tab') {
        const f = ref.current ? ref.current.querySelectorAll('button:not(:disabled), [href], input, [tabindex]:not([tabindex="-1"])') : [];
        if (!f.length) return;
        const first = f[0];
        const lastEl = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, []);

  async function pick(c) {
    setTarget(c);
    try {
      await onSwitch(c);
    } finally {
      setTarget(null);
    }
  }

  return (
    <div
      className="sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pay-t"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="card pinned"
        ref={ref}
        style={dragY ? { transform: `translateY(${dragY}px)`, transition: 'none' } : undefined}
        onTouchStart={(e) => {
          startY.current = e.target.closest?.('.sheetscroll')?.scrollTop > 0 ? null : e.touches[0].clientY;
        }}
        onTouchMove={(e) => {
          if (startY.current === null) return;
          setDragY(Math.max(0, e.touches[0].clientY - startY.current));
        }}
        onTouchEnd={() => {
          if (dragY > 90) onClose();
          else setDragY(0);
          startY.current = null;
        }}
      >
        <div className="sheetscroll">
          <div className="grab" aria-hidden="true" />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
            <div style={{ minWidth: 0 }}>
              <h3 id="pay-t">{order.label}</h3>
              <b style={{ color: 'var(--gold2)' }}>${fmtUsd(order.usd)}</b>
            </div>
            {left !== null && (
              <div style={{ textAlign: 'end', flexShrink: 0 }}>
                <small className="mute" style={{ display: 'block' }}>{t('pay.expiresLabel')}</small>
                <b style={{ fontSize: 28, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums', color: left === 0 ? 'var(--red)' : left < 60 ? 'var(--gold)' : undefined }}>
                  {left === 0 ? t('pay.expired') : fmtTime(left)}
                </b>
              </div>
            )}
          </div>
          {canSwitch && <CoinTabs value={coin} onChange={pick} disabled={busy} />}
          <div style={{ opacity: busy ? 0.45 : 1, transition: 'opacity 0.2s' }}>
            <Details key={order.id} order={order} />
          </div>
        </div>
        <div className="sheetfoot" style={busy ? { pointerEvents: 'none', opacity: 0.6 } : undefined}>
          <Actions key={order.id} order={order} show={show} onCancel={onCancel} />
        </div>
      </div>
    </div>
  );
}
