'use client';
// Deposit flow of our own gateway checkout: 1 amount, 2 coin, 3 connect the wallet (auto coins) or pay manually (the other coins).
// The screen comes from state: no open order = amount or coin (stage), an order = connect, the manual flag = manual. The coin comes from the order.
import { useEffect, useRef, useState } from 'react';
import { post } from '@/lib/api';
import { triggerHaptic } from '@/lib/haptics';
import { formatUsd } from '@/lib/useMined';
import Field from '@/components/Field';
import { Qr } from '@/components/Qr';
import { CoinPicker, PayInfo, useExpired } from '@/components/PayCoin';
import { ConnectBtn, Spin, connectKind, tryOpen } from '@/components/ConnectPay';
import { useWallet } from '@/components/WalletProvider';
import { useT } from '@/components/I18nProvider';

const CHIPS = [30, 100, 500, 1000];
const SLIDER_MAX = 250000;
const SPOS = 1000; // slider positions: the scale is logarithmic so $30 to $250,000 stays easy to set
const toPos = (v, lo, hi) => (hi > lo ? Math.round((SPOS * Math.log(v / lo)) / Math.log(hi / lo)) : SPOS);
const fromPos = (p, lo, hi) => {
  const v = lo * Math.pow(hi / lo, p / SPOS);
  const s = v < 1000 ? 1 : v < 10000 ? 10 : v < 100000 ? 100 : 1000;
  return Math.min(hi, Math.max(lo, Math.round(v / s) * s));
};
const ENVS = [['tg', 'dep.envTg'], ['site', 'dep.envSite'], ['pwa', 'dep.envPwa']];
const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
// Site and app: skip USDT on TON (no jetton send over TON Connect). Telegram shows every network.
const SITE_SKIP = ['ton'];
const TON_COIN = { asset: 'ton', net: 'ton' };
// Coins that pay by Connect wallet, in Telegram and on site and app: ETH, BNB, TON and USDT on EVM. The rest (BTC, USDT on TON in Telegram) pay manually.
const isAuto = (c) => c.asset === 'eth' || c.asset === 'bnb' || c.asset === 'ton' || (c.asset === 'usdt' && c.net !== 'ton');

function copyText(text) {
  triggerHaptic('success');
  try {
    const p = navigator.clipboard?.writeText(text);
    if (p && p.catch) p.catch(() => {});
  } catch {}
}

const CSS = '.dfstep{--dx:12px;animation:dfIn .25s ease-out}[dir=rtl] .dfstep{--dx:-12px}@keyframes dfIn{from{opacity:0;transform:translateX(var(--dx))}to{opacity:1;transform:none}}.dfenv{position:relative;overflow:hidden;display:flex;align-items:center;gap:10px;height:44px;padding:0 14px;margin:0 0 12px;border-radius:12px;border:1px solid #3d3519;background:rgba(232,184,74,.06);opacity:.55;transition:opacity .3s,border-color .3s}.dfenv.ok{opacity:1;border-color:#e8b84a}.dfenv.chk::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 30%,rgba(232,184,74,.28) 50%,transparent 70%);transform:translateX(-100%);animation:dfSweep 1.1s linear infinite}[dir=rtl] .dfenv.chk::after{animation-name:dfSweepR}@keyframes dfSweep{to{transform:translateX(100%)}}@keyframes dfSweepR{from{transform:translateX(100%)}to{transform:translateX(-100%)}}.dfico{width:22px;height:22px;overflow:hidden;flex:none;color:#e8b84a}.dfroll{display:flex;flex-direction:column;transition:transform .35s cubic-bezier(.3,1.4,.5,1)}.dfroll svg{width:22px;height:22px;flex:none}.dfenv.chk .dfroll{animation:dfRoll .9s steps(1) infinite}@keyframes dfRoll{0%{transform:translateY(0)}33.33%{transform:translateY(-22px)}66.66%{transform:translateY(-44px)}}.dfenvl{height:20px;overflow:hidden;line-height:20px;font-size:14px;font-weight:600}.dfenvl>span{display:block;height:20px;transition:transform .3s}.dfenv.ok .dfenvl>span{transform:translateY(-20px)}.dfback{background:none;border:0;padding:4px 8px 4px 0;margin:0 0 6px;color:inherit;cursor:pointer;display:inline-flex}[dir=rtl] .dfback{padding:4px 0 4px 8px}[dir=rtl] .dfback svg{transform:scaleX(-1)}.dfcol{display:flex;flex-direction:column;gap:8px}.dfrange{-webkit-appearance:none;appearance:none;display:block;width:100%;height:24px;margin:4px 0 14px;padding:0;border:0;background:transparent;box-sizing:border-box;--f:0;--d:right}[dir=rtl] .dfrange{--d:left}.dfrange::-webkit-slider-runnable-track{height:8px;border-radius:4px;background:linear-gradient(to var(--d),#e8b84a calc(11px + (100% - 22px) * var(--f)),#3d3519 0)}.dfrange::-webkit-slider-thumb{-webkit-appearance:none;width:22px;height:22px;margin-top:-7px;border:0;border-radius:50%;background:#e8b84a}.dfrange::-moz-range-track{height:8px;border-radius:4px;background:linear-gradient(to var(--d),#e8b84a calc(11px + (100% - 22px) * var(--f)),#3d3519 0)}.dfrange::-moz-range-thumb{width:22px;height:22px;border:0;border-radius:50%;background:#e8b84a}.dfchips{display:grid;gap:8px}.dfchips .pct-btn{width:100%;margin:0}';

const ENV_ICONS = [
  <path key="tg" d="M21 3L10 14M21 3l-7 18-4-7-7-4z" />,
  <g key="site"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" /></g>,
  <g key="pwa"><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></g>,
];

const linkBtn = { background: 'none', border: 0, padding: '10px 0 0', margin: 0, font: 'inherit', fontSize: 13, color: '#9aa6c2', textDecoration: 'underline', cursor: 'pointer', alignSelf: 'center' };

export default function DepositFlow({ minDep, ready, show, refreshDod, onCancel, orders }) {
  const dt = useT();
  const w = useWallet();
  const [env, setEnv] = useState('site');
  const [amt, setAmt] = useState('');
  const [usd, setUsd] = useState(0);
  const [stage, setStage] = useState('amount');
  const [coin, setCoin] = useState({ asset: 'eth', net: 'eth' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState(false); // false | 'direct' (a manual coin, straight from the coin step) | 'link' (Pay manually on the connect screen)
  const [phase, setPhase] = useState('done');
  const [gone, setGone] = useState(() => new Set());
  const [qr, setQr] = useState(false);
  const [opening, setOpening] = useState(false);
  const key = useRef(null); // idempotency key of the order in progress: { sig, key }
  const last = useRef(null); // the last order shown, kept while a coin change is busy so nothing flickers
  const direct = useRef(false); // the order being made is for a manual coin: open the manual screen when it appears

  useEffect(() => {
    const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone;
    setEnv(w.tg ? 'tg' : standalone ? 'pwa' : 'site');
    if (w.tg) setCoin(TON_COIN);
  }, [w.tg]);

  const cur = (orders || []).find((o) => o.address && !gone.has(o.id)) || null;
  if (cur) last.current = cur;
  const order = cur || (busy ? last.current : null);
  const others = (orders || []).filter((o) => o.url && !gone.has(o.id));
  const oid = order?.id;
  const expired = useExpired(order?.expiresAt); // timed out: no pay buttons, only Expired, the coin tabs (a new order) and Cancel

  // A new order: a manual coin goes straight to the manual screen; otherwise the device chips pulse for a moment, then the detected one is pressed.
  useEffect(() => {
    if (!oid) return undefined;
    if (direct.current) {
      direct.current = false;
      setManual('direct');
    }
    setPhase('checking');
    const id = setTimeout(() => setPhase('done'), 1100);
    return () => clearTimeout(id);
  }, [oid]);

  const kind = order ? connectKind(order, w) : null;
  const acct = kind === 'ton' ? w.tonAcct : kind === 'evm' ? w.acct : '';
  const connected = !!kind && !!acct;
  const screen = order ? (manual ? 'manual' : 'connect') : stage;
  const tg = env === 'tg';

  async function create(amount, c) {
    setBusy(true);
    setErr('');
    direct.current = !isAuto(c, tg);
    try {
      const body = { usd: amount, asset: c.asset, network: c.net };
      const sig = JSON.stringify(body);
      if (key.current?.sig !== sig) key.current = { sig, key: uid() };
      await post('/api/wallet/deposit', body, key.current.key);
      key.current = null;
      await refreshDod().catch(() => {});
    } catch (e) {
      direct.current = false;
      triggerHaptic('error');
      setErr(e.status ? e.message : dt('common.noConnection'));
    } finally {
      setBusy(false);
    }
  }

  // Step 1 to 2: check the amount.
  function next() {
    if (busy) return;
    const v = parseFloat(amt);
    if (!(v > 0)) {
      triggerHaptic('error');
      setErr(dt('err.depAmount'));
      return;
    }
    if (v < minDep) {
      triggerHaptic('error');
      setErr(dt('err.wdMin', { n: minDep }));
      return;
    }
    setUsd(Math.round(v * 100) / 100);
    setErr('');
    setStage('coin');
  }

  // A coin change = cancel the open order and make a new one for the same amount.
  async function switchCoin(nextCoin) {
    if (busy || !order) return;
    const prev = order;
    last.current = prev;
    setBusy(true);
    try {
      await post('/api/orders/cancel', { id: prev.id });
      setGone((s) => new Set(s).add(prev.id));
    } catch (e) {
      show(e.status ? e.message : dt('common.noConnection'));
      setBusy(false);
      return;
    }
    await create(prev.usd, nextCoin);
  }

  // `to` = the stage to show next: 'coin' (Back) or 'amount' (Cancel).
  function leave(id, to = 'amount') {
    setGone((s) => new Set(s).add(id));
    last.current = null;
    setManual(false);
    setQr(false);
    setStage(to);
    onCancel(id);
  }

  function back() {
    triggerHaptic('light');
    if (screen === 'coin') setStage('amount');
    else if (screen === 'manual' && manual === 'link') setManual(false);
    else if (order) leave(order.id, 'coin');
  }

  // Telegram's webview cannot hand a link to a wallet, except the TON one that opens in the browser.
  const canOpen = !!order && !!order.uri && /^[a-z][a-z0-9+.-]*:/i.test(order.uri) && !(w.tg && order.network !== 'ton');
  async function openWallet() {
    if (opening || !order) return;
    // Telegram's webview does not hand ton:// to a wallet: open the https form of the same link in its own browser instead.
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
    show(dt('pay.noWallet'));
    setManual('link');
  }

  const openBtn = canOpen && (
    <button type="button" className="btn ghost" onClick={openWallet} disabled={opening}>
      {opening && <Spin />}
      {dt('plans.openWallet')}
    </button>
  );
  const scanBtn = (
    <button type="button" className="btn ghost" aria-pressed={qr} onClick={() => setQr(!qr)}>{dt('dep.scan')}</button>
  );
  const expiredBlock = order && (
    <div className="dfcol">
      <p className="fine" role="alert" style={{ margin: 0, color: 'var(--red)' }}>{dt('pay.expired')}</p>
      <button type="button" className="btn ghost" onClick={() => leave(order.id)}>{dt('wal.depCancel')}</button>
    </div>
  );
  const short = acct ? `${acct.slice(0, 6)}\u2026${acct.slice(-4)}` : '';
  const slo = Math.max(minDep, 1);
  const smax = Math.max(SLIDER_MAX, slo);
  const sv = Math.min(Math.max(parseFloat(amt) || slo, slo), smax);
  const spos = toPos(sv, slo, smax);
  const chips = CHIPS.filter((v) => v >= minDep);

  return (
    <div>
      <style>{CSS}</style>
      {screen !== 'amount' && (
        <button type="button" className="dfback" aria-label={dt('dep.back')} onClick={back}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
        </button>
      )}

      <div className="dfstep" key={screen}>
        {screen === 'amount' && (
          <div>
            <Field id="du" label={dt('wal.depUsd')} error={err}>
              <input
                id="du"
                inputMode="decimal"
                className={err ? 'bad' : undefined}
                aria-invalid={!!err}
                aria-describedby={err ? 'du-err' : undefined}
                placeholder="0.00"
                value={amt}
                onChange={(e) => {
                  setAmt(e.target.value);
                  if (err) setErr('');
                }}
              />
            </Field>
            <input
              type="range"
              className="dfrange"
              aria-label={dt('wal.depUsd')}
              min={0}
              max={SPOS}
              step={1}
              value={spos}
              style={{ '--f': spos / SPOS }}
              onChange={(e) => {
                setAmt(String(fromPos(Number(e.target.value), slo, smax)));
                if (err) setErr('');
              }}
            />
            <div className="pct-row dfchips" style={{ gridTemplateColumns: `repeat(${Math.max(chips.length, 1)},1fr)` }}>
              {chips.map((v) => (
                <button key={v} type="button" className="pct-btn" onClick={() => { triggerHaptic('selection'); setAmt(String(v)); setErr(''); }}>${v}</button>
              ))}
            </div>
            <p className="fine" style={{ margin: '6px 0 10px' }}>{dt('wal.depNote', { n: minDep })}</p>
            <button className="btn" type="button" onClick={next} disabled={!ready}>
              {dt('dep.pickCoin')}
            </button>
          </div>
        )}

        {screen === 'coin' && (
          <div>
            <p className="fine" style={{ margin: '0 0 10px' }}>{dt('wal.depOrder', { n: formatUsd(usd) })}</p>
            <CoinPicker skipNets={tg ? undefined : SITE_SKIP} value={coin} onChange={setCoin} disabled={busy} mark={(id) => isAuto({ asset: id, net: id === 'usdt' ? 'eth' : id }, tg)} />
            {err && <p className="fine" role="alert" style={{ margin: '0 0 8px', color: 'var(--red)' }}>{err}</p>}
            <button className="btn" type="button" onClick={() => create(usd, coin)} disabled={busy || !ready}>
              {busy && <Spin />}
              {dt('dep.pay', { n: `$${formatUsd(usd)}` })}
            </button>
          </div>
        )}

        {screen === 'connect' && order && (
          <div>
            <div className={`dfenv ${phase === 'checking' ? 'chk' : 'ok'}`} role="status">
              <span className="dfico" aria-hidden="true">
                <span className="dfroll" style={{ transform: `translateY(${-22 * Math.max(ENVS.findIndex(([id]) => id === env), 0)}px)` }}>
                  {ENV_ICONS.map((p, i) => (
                    <svg key={i} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{p}</svg>
                  ))}
                </span>
              </span>
              <span className="dfenvl">
                <span>{dt('dep.checking')}</span>
                <span>{dt((ENVS.find(([id]) => id === env) || ENVS[1])[1])}</span>
              </span>
            </div>
            {phase === 'checking' ? null : expired ? expiredBlock : (
              <div className="dfcol">
                {connected && <p className="fine" style={{ margin: 0 }}>{`${dt('dep.connected')} \u00b7 ${short}`}</p>}
                {connected || env !== 'pwa' ? (
                  <ConnectBtn big order={order} show={show} onFail={() => {}} payLabel={dt('dep.pay', { n: `$${formatUsd(order.usd)}` })} />
                ) : null}
                {!connected && env !== 'site' && openBtn}
                {!connected && env !== 'tg' && scanBtn}
                <button type="button" style={linkBtn} onClick={() => setManual('link')}>{dt('dep.manual')}</button>
              </div>
            )}
            {qr && !expired && <Qr value={order.uri || order.address} />}
          </div>
        )}

        {screen === 'manual' && order && (
          <div>
            <CoinPicker skipNets={tg ? undefined : SITE_SKIP} value={{ asset: order.asset || 'btc', net: order.network }} onChange={switchCoin} disabled={busy} />
            <PayInfo order={order} show={show} slim />
            <div className="dfcol" style={{ marginTop: 10 }}>
              {!expired && canOpen && openBtn}
              {!expired && (
                <>
                  <button type="button" className="btn ghost" onClick={() => { copyText(order.address); show(dt('wal.copied')); }}>{dt('wal.copy')}</button>
                  <button type="button" className="btn ghost" onClick={() => { copyText(String(order.amount)); show(dt('wal.copied')); }}>{dt('pay.copyAmt')}</button>
                </>
              )}
              <button type="button" className="btn ghost" onClick={() => leave(order.id)}>{dt('wal.depCancel')}</button>
            </div>
          </div>
        )}
      </div>

      {others.map((o) => (
        <div key={o.id} className="row" style={{ marginTop: 12, gap: 8 }}>
          <small style={{ minWidth: 0 }}>{dt('wal.depOrder', { n: formatUsd(o.usd) })}</small>
          <button className="btn ghost" type="button" onClick={() => { setGone((s) => new Set(s).add(o.id)); onCancel(o.id); }}>{dt('wal.depCancel')}</button>
        </div>
      ))}
    </div>
  );
}
