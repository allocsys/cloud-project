'use client';
import PageHead from '@/components/PageHead';
import { PendingCards } from '@/components/PendingOrders';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { formatBtc, formatUsd } from '@/lib/useMined';
import { WalletBalance } from '@/components/LiveNumbers';
import { MIN_WITHDRAW_USD, MIN_DEPOSIT_USD } from '@/lib/data';
import { smartPick, reinvestTitle, reinvestHref } from '@/lib/reinvest';
import { ASSETS, NETWORKS, SWAP_FEE_PCT, quote, depositQuote, priceOf, floorCoin, validAddress } from '@/lib/assets';
import { serviceTier, serviceLine, serviceProgress } from '@/lib/service-fee';
import { useApi, post } from '@/lib/api';
import { qrMatrix, qrPath } from '@/lib/qr';
import { useToast } from '@/components/Toast';
import { triggerHaptic } from '@/lib/haptics';
import Field from '@/components/Field';
import { fill, useLang, useT } from '@/components/I18nProvider';
import { CoinPicker, PayInfo } from '@/components/PayCoin';
import DepositFlow from '@/components/DepositFlow';
import { DEFAULT_PAY } from '@/lib/pay-coins';
import { histLabel, histDate, histFee, histNet } from '@/lib/i18n/history';
import { dayText } from '@/lib/i18n/notes';

const KIND = {
  payout: { glyph: '↓', cls: 'in' },
  deposit: { glyph: '+', cls: 'in' },
  purchase: { glyph: '◆', cls: 'buy' },
  referral: { glyph: '+', cls: 'in' },
  adjustment: { glyph: '±', cls: 'in' },
  withdrawal: { glyph: '↑', cls: 'out' },
};

const STATUS = { pending: 'wal.stPending', approved: 'wal.stApproved', sent: 'wal.stSent', failed: 'wal.stFailed', rejected: 'wal.stRejected', expired: 'pay.expired' };

const FILTERS = [['all', 'wal.fAll'], ['payout', 'wal.fPayouts'], ['withdrawal', 'wal.withdraw'], ['deposit', 'wal.fDeposits']];

// True while the element is on screen, so its animation pauses when it is not.
function useSeen() {
  const ref = useRef(null);
  const [seen, setSeen] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([e]) => setSeen(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, seen];
}

// Withdraw steps: readable active tab, step slide, back arrow, amount slider.
const WSTEP_CSS = '.wcard .tabs button[aria-pressed=true]{background:#e8b84a;color:#1a1405;font-weight:500}.wstep{--dx:12px;animation:wsIn .25s ease-out}[dir=rtl] .wstep{--dx:-12px}@keyframes wsIn{from{opacity:0;transform:translateX(var(--dx))}to{opacity:1;transform:none}}.wback{background:none;border:0;padding:4px 8px 4px 0;margin:0 0 6px;color:inherit;cursor:pointer;display:inline-flex}[dir=rtl] .wback{padding:4px 0 4px 8px}[dir=rtl] .wback svg{transform:scaleX(-1)}.wrange{-webkit-appearance:none;appearance:none;display:block;width:100%;height:24px;margin:4px 0 14px;padding:0;border:0;background:transparent;box-sizing:border-box;--f:0;--d:right}[dir=rtl] .wrange{--d:left}.wrange::-webkit-slider-runnable-track{height:8px;border-radius:4px;background:linear-gradient(to var(--d),#e8b84a calc(11px + (100% - 22px) * var(--f)),#3d3519 0)}.wrange::-webkit-slider-thumb{-webkit-appearance:none;width:22px;height:22px;margin-top:-7px;border:0;border-radius:50%;background:#e8b84a}.wrange::-moz-range-track{height:8px;border-radius:4px;background:linear-gradient(to var(--d),#e8b84a calc(11px + (100% - 22px) * var(--f)),#3d3519 0)}.wrange::-moz-range-thumb{width:22px;height:22px;border:0;border-radius:50%;background:#e8b84a}';

// Wallet motion: transform and opacity only. A light band crosses the balance card, activity rows fade in one by one, the fee quote fades in.
const WALLET_CSS = '.whero{position:relative;overflow:hidden}.wshine{position:absolute;top:0;bottom:0;left:0;width:45%;pointer-events:none;background:linear-gradient(100deg,transparent,rgba(255,255,255,.1),transparent);animation:wShine 8s ease-in-out infinite}@keyframes wShine{0%,55%{transform:translateX(-130%) skewX(-18deg)}100%{transform:translateX(330%) skewX(-18deg)}}.wpause .wshine{animation-play-state:paused}.wrow{animation:wRow .35s ease-out both}@keyframes wRow{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}.quote{animation:wQuote .25s ease-out}@keyframes wQuote{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}.tgring{position:absolute;top:0;left:0;right:0;bottom:0;border-radius:50%;border:2px solid #2AABEE;animation:tgPulse 1.8s ease-out infinite}@keyframes tgPulse{0%{transform:scale(1);opacity:.55}100%{transform:scale(1.7);opacity:0}}.tgdots i{display:inline-block;width:5px;height:5px;border-radius:50%;background:#F5A623;margin:0 2px;animation:tgDot 1.2s infinite}.tgdots i:nth-child(2){animation-delay:.2s}.tgdots i:nth-child(3){animation-delay:.4s}@keyframes tgDot{0%,80%,100%{opacity:.25}40%{opacity:1}}' + '.wrow{transition:filter .2s}.wrow.wstale{filter:opacity(.45)}' + WSTEP_CSS;

const floorTo = (n, d) => Math.floor(n * 10 ** d) / 10 ** d;
const ceilTo = (n, d) => Math.ceil(n * 10 ** d - 1e-9) / 10 ** d;
const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

// USD value of an activity row. Amounts are in the row's own coin; purchases are already dollars.
function usdOf(h, prices) {
  if (h.kind === 'purchase' || !h.coin) return null;
  const id = h.coin.toLowerCase();
  const v = Math.abs(parseFloat(h.amount));
  return ASSETS[id] && v > 0 ? v * priceOf(id, prices) : null;
}

function DepositQr({ value }) {
  const t = useT();
  const qr = useMemo(() => {
    try {
      const m = qrMatrix(value);
      return { size: m.length, d: qrPath(m) };
    } catch {
      return null;
    }
  }, [value]);
  if (!qr) return null;
  const pad = 3;
  const box = qr.size + pad * 2;
  return (
    <div className="qr">
      <svg viewBox={`${-pad} ${-pad} ${box} ${box}`} role="img" aria-label={t('wal.qr')} shapeRendering="crispEdges">
        <rect x={-pad} y={-pad} width={box} height={box} fill="#fff" />
        <path d={qr.d} fill="#0b0a08" />
      </svg>
    </div>
  );
}

// Coin buttons, plus a network switch for coins that live on more than one chain (USDT).
function Picker({ asset, net, onAsset, onNet, fill }) {
  const t = useT();
  const nets = Object.keys(ASSETS[asset].nets);
  return (
    <>
      <div className="assets" role="group" aria-label={t('wal.coin')} style={fill ? { display: 'grid', gridTemplateColumns: `repeat(${Object.keys(ASSETS).length},minmax(0,1fr))`, gap: 8 } : undefined}>
        {Object.entries(ASSETS).map(([id, a]) => (
          <button key={id} type="button" className="pct-btn" aria-pressed={asset === id} onClick={() => onAsset(id)}>
            {a.sym}
          </button>
        ))}
      </div>
      {nets.length > 1 && (
        <div className="netrow">
          <span>{t('wal.network')}</span>
          <div className="minitabs" role="group" aria-label={t('wal.network')}>
            {nets.map((n) => (
              <button key={n} type="button" aria-pressed={net === n} onClick={() => onNet(n)}>
                {NETWORKS[n].short}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// Enter the amount in the coin itself or in dollars.
function UnitSwitch({ sym, unit, onUnit }) {
  const t = useT();
  return (
    <div className="minitabs uswitch" role="group" aria-label={t('wal.unitAria')}>
      <button type="button" aria-pressed={unit === 'coin'} onClick={() => onUnit('coin')}>{sym}</button>
      <button type="button" aria-pressed={unit === 'usd'} onClick={() => onUnit('usd')}>USD</button>
    </div>
  );
}

import { PH_HISTORY } from '@/lib/placeholder';

export default function Wallet() {
  const { t, lang } = useLang();
  // The live ticker runs at the rate of the user's own online miners (none online means no ticks), the same as the
  // dashboard, so Available here and the dashboard goal agree and Max never exceeds what the server will accept.
  // It ticks inside WalletBalance (components/LiveNumbers.js) and mirrors the live figure into liveAvailable.
  const liveAvailable = useRef(0);
  const { data: md } = useApi('/api/miners', { ttl: 10000 });
  const dailyUsd = (md ? md.contracts : []).filter((c) => c.online).reduce((s, c) => s + c.dailyUsd, 0);
  // Prices and the wallet come from the cached API: instant from cache, refreshed quietly.
  // Until the first wallet response arrives the balance shows a dash (never sample data); static prices fill in for prices.
  const { data: pd } = useApi('/api/prices', { ttl: 30000, poll: 30000 });
  // The history is paged on the server (?limit=&kind=): 20 rows at a time, filtered there, so the
  // screen never downloads the whole 500-row history to show a few rows.
  const [filter, setFilter] = useState('all');
  const [limit, setLimit] = useState(20);
  // keepStale: a bigger page size keeps the rows on screen while the longer list loads; a new filter does not (sameFilter below).
  const { data: wd, dataUrl: wdUrl, mutate, refresh } = useApi(`/api/wallet?limit=${limit}&kind=${filter}`, { ttl: 10000, keepStale: true });
  const sameFilter = wdUrl.endsWith(`&kind=${filter}`); // the data on hand is for the filter that is selected
  const { data: cat } = useApi('/api/plans', { ttl: 20000 });
  const { data: me } = useApi('/api/auth/me', { ttl: 60000 });
  const tf = !!me?.twofa; // two-factor on: a withdrawal needs the code
  const [code, setCode] = useState('');
  const [tgWait, setTgWait] = useState(false); // the code went to Telegram: waiting for the Accept tap (accounts with no two-factor and no verified email)
  const [showCode, setShowCode] = useState(false); // the typed-code box, shown only after 'Didn't get it?'
  const [mailPop, setMailPop] = useState(false); // the code went to the email: the pop-up asks for it
  const [mailAt, setMailAt] = useState(0); // when it was sent (a new one can be asked for after a minute)
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!mailPop) return undefined;
    const i = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(i);
  }, [mailPop]);
  const [tgBot, setTgBot] = useState('vertexhashbot'); // the bot the Open Telegram button opens (the poll brings the real name)
  const wdRef = useRef(null); // the latest withdraw(), called by the poll below
  const prices = pd?.prices;
  const [tab, setTab] = useState('withdraw');
  const [asset, setAsset] = useState('btc');
  const [net, setNet] = useState('btc');
  const [unit, setUnit] = useState('usd');
  const [wStep, setWStep] = useState(1); // withdraw step: 1 amount, 2 coin, 3 address
  const [amount, setAmount] = useState('');
  const [address, setAddress] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [dep, setDep] = useState('');
  const [toast, show] = useToast();
  const [heroRef, heroSeen] = useSeen();
  // Deposit through the crypto provider (a hosted payment page), when it is switched on. The open top-up orders come with the same answer.
  const { data: dod, refresh: refreshDod } = useApi('/api/orders?kind=deposit', { ttl: 10000 });
  const cryptoOn = !!dod?.crypto;
  const minDep = dod?.min ?? MIN_DEPOSIT_USD; // the admin's minimum; the shown text waits for this answer
  const depPending = (dod?.orders || []).filter((o) => o.status === 'pending');
  const [depUsd, setDepUsd] = useState('');
  const [depErr, setDepErr] = useState('');
  const [payCoin, setPayCoin] = useState(DEFAULT_PAY); // the coin a top-up is paid in (our own checkout only)
  const depKey = useRef(null); // idempotency key of the top-up in progress: { usd, key }
  const wdKey = useRef(null); // idempotency key of the withdrawal in progress: { sig, key }

  // While the Accept tap is awaited, ask every 2.5 s. Accepted: withdraw by itself (the server lets it pass once). Denied, used or expired: say so.
  useEffect(() => {
    if (!tgWait) return undefined;
    let live = true;
    const tick = async () => {
      try {
        const r = await fetch('/api/wallet/wdcode', { headers: { accept: 'application/json' }, cache: 'no-store' });
        if (!live || !r.ok) return;
        const { state, bot } = await r.json();
        if (bot && live) setTgBot(bot);
        if (!live) return;
        if (state === 'approved') {
          live = false;
          setTgWait(false);
          if (wdRef.current) wdRef.current();
        } else if (state === 'none') {
          live = false;
          setTgWait(false);
          triggerHaptic('error');
          show(t('wal.tgEnded'));
        }
      } catch {}
    };
    const i = setInterval(tick, 2500);
    return () => {
      live = false;
      clearInterval(i);
    };
  }, [tgWait]);

  async function startDeposit() {
    if (busy) return;
    const v = parseFloat(depUsd);
    if (!(v > 0)) {
      triggerHaptic('error');
      setDepErr(t('err.depAmount'));
      return;
    }
    if (v < minDep) {
      triggerHaptic('error');
      setDepErr(t('err.wdMin', { n: minDep }));
      return;
    }
    setDepErr('');
    setBusy(true);
    let leaving = false;
    try {
      const usd = Math.round(v * 100) / 100;
      const body = dod?.multi ? { usd, asset: payCoin.asset, network: payCoin.net } : { usd };
      const sig = JSON.stringify(body);
      if (depKey.current?.sig !== sig) depKey.current = { sig, key: uid() };
      const r = await post('/api/wallet/deposit', body, depKey.current.key);
      if (r.pending && r.order?.url) {
        leaving = true;
        window.location.assign(r.order.url);
        return;
      }
      depKey.current = null;
      setDepUsd('');
      if (r.order?.address) show(t('pay.sendExact'));
    } catch (e) {
      triggerHaptic('error');
      setDepErr(e.status ? e.message : t('common.noConnection'));
    } finally {
      if (!leaving) {
        setBusy(false);
        refreshDod().catch(() => {});
      }
    }
  }

  async function cancelDep(id, quiet = false) {
    triggerHaptic('light');
    try {
      await post('/api/orders/cancel', { id });
    } catch (e) {
      if (!quiet) show(e.status ? e.message : t('common.noConnection')); // quiet: the order already timed out, so the server refuses and that is fine
    }
    refreshDod().catch(() => {});
  }

  // While a top-up is open, look for the payment every few seconds. When one turns paid, say so and refresh the balance.
  useEffect(() => {
    if (!depPending.length) return undefined;
    const i = setInterval(() => refreshDod().catch(() => {}), 5000);
    return () => clearInterval(i);
  }, [depPending.length]);
  const depSeen = useRef(new Set());
  useEffect(() => {
    if (!dod) return;
    const ids = new Set(depPending.map((o) => o.id));
    for (const id of depSeen.current) {
      if (!ids.has(id) && dod.orders.find((o) => o.id === id)?.status === 'paid') {
        triggerHaptic('success');
        show(t('wal.depPaid'));
        refresh().catch(() => {});
      }
    }
    depSeen.current = ids;
  }, [dod]);
  // Back from the payment page can restore this page as it was left: free the button and start the next top-up with a fresh key.
  useEffect(() => {
    const back = (e) => {
      if (!e.persisted) return;
      setBusy(false);
      depKey.current = null;
      refreshDod().catch(() => {});
    };
    window.addEventListener('pageshow', back);
    return () => window.removeEventListener('pageshow', back);
  }, []);
  const btcUsd = priceOf('btc', prices);
  const ready = !!wd;
  const history = wd && sameFilter ? wd.history : [];
  // Server balance at the last fetch. The live accrual since then (what the online miners added
  // since the server worked out the wallet) ticks inside WalletBalance; the tap handlers below
  // read it from liveAvailable so Max and the withdraw check see the same number on screen.
  const available = wd ? Math.max(0, wd.earned - wd.withdrawn - (wd.spent || 0)) : 0;
  // The Reinvest card shows once the balance covers a plan, and suggests the biggest one it can pay for.
  const balUsd = available * btcUsd;
  const rein = ready ? smartPick([], balUsd, cat ? cat.halls : undefined) : null;
  const A = ASSETS[asset];
  const N = NETWORKS[net];
  const price = priceOf(asset, prices);
  const usdMode = unit === 'usd';
  const toCoin = (v) => (usdMode ? v / price : v);
  const parsed = parseFloat(amount);
  const coinAmt = parsed > 0 ? floorCoin(asset, toCoin(parsed)) : 0; // rounded down to the coin's decimals, as the server does
  // The withdrawal service fee tier, counted from the last withdrawal (or the first purchase). The server decides the real one.
  const tier = ready && wd.svcSince ? serviceTier(wd.svcSince) : null;
  const goal = tier ? serviceProgress(wd.svcSince) : null; // the bar toward the fee-free tier
  const svcPct = tier ? tier.pct : 0;
  const q = coinAmt > 0 ? quote(asset, net, coinAmt, prices, svcPct) : null;
  const flatFee = A.nets[net];
  const dp = parseFloat(dep);
  const depCoin = dp > 0 ? toCoin(dp) : 0;
  const dq = depCoin > 0 ? depositQuote(asset, depCoin, prices) : null;
  // Invite income counts as a payout; the kind filter already ran on the server.
  // Another filter is loading: the rows on hand stay on screen, dimmed, instead of flashing placeholders (and the swap needs no second fade).
  const stale = !!wd && !sameFilter;
  const shown = stale ? wd.history : history;
  // History opened before its first answer: three placeholder rows in the loading look (lib/placeholder.js, .ld).
  const loadingRows = shown.length === 0 && !(ready && sameFilter);

  // The minimum is the admin's dollar amount (from /api/plans) worth of coin, shown in whatever unit the person is typing in.
  const minUsd = cat?.minWithdraw ?? MIN_WITHDRAW_USD;
  const minText = usdMode ? `$${formatUsd(ceilTo(minUsd, 2))}` : `${ceilTo(minUsd / price, A.dec).toFixed(A.dec)} ${A.sym}`;
  const dec = usdMode ? 2 : A.dec;

  function setFraction(pct) {
    triggerHaptic('selection');
    const usd = (liveAvailable.current || available) * pct * btcUsd;
    setAmount(floorTo(usdMode ? usd : usd / price, dec).toFixed(dec));
    setErrors({ ...errors, amount: undefined });
  }

  function handleTabChange(nextTab) {
    if (tab !== nextTab) {
      triggerHaptic('selection');
      setTab(nextTab);
      setUnit(nextTab === 'withdraw' ? 'usd' : 'coin');
      setWStep(1);
      setErrors({});
    }
  }

  // Switching unit keeps the same value, just restated in the other unit.
  function pickUnit(next) {
    if (next === unit) return;
    triggerHaptic('selection');
    const conv = (s) => {
      const v = parseFloat(s);
      if (!(v > 0)) return s;
      return next === 'usd' ? (v * price).toFixed(2) : (v / price).toFixed(A.dec);
    };
    setAmount(conv(amount));
    setDep(conv(dep));
    setUnit(next);
    setErrors({});
  }

  // A pasted address belongs to one network and amounts belong to one coin, so changing coin clears them.
  function pickAsset(id) {
    if (id === asset) return;
    triggerHaptic('selection');
    setAsset(id);
    setNet(Object.keys(ASSETS[id].nets)[0]);
    if (tab !== 'withdraw') setAmount(''); // the withdraw amount is in dollars: it survives a coin change
    setDep('');
    setAddress('');
    setErrors({});
  }

  function pickNet(id) {
    if (id === net) return;
    triggerHaptic('selection');
    setNet(id);
    setAddress('');
    setErrors({});
  }

  // Checks locally for instant feedback, shows the withdrawal at once, then lets the server decide.
  // If the server says no, the screen rolls back and shows its message.
  async function withdraw(opts) {
    if (busy || !wd) return;
    const typed = opts?.resend ? '' : code.trim();
    const next = {};
    const wq = coinAmt > 0 ? quote(asset, net, coinAmt, prices, svcPct) : null;
    if (!wq) next.amount = t('wal.errAmount');
    else if (wq.usd < minUsd - 0.01) next.amount = t('wal.errMin', { min: minText }); // dollars at live prices, the same check the server makes
    else if (wq.btc > (liveAvailable.current || available) * (1 + 1e-9) + 1e-12) next.amount = t('wal.errMore');
    else if (wq.receive <= 0) next.amount = t('wal.errSmall');
    if (!validAddress(net, address.trim())) next.address = t('wal.errAddr', { net: N.label });
    if ((tf || (mailPop && !opts?.resend)) && !typed) next.code = t('wal.errCode');

    if (next.amount || next.address || next.code) {
      triggerHaptic('error');
      setErrors(next);
      if (next.amount) setWStep(1);
      setTimeout(() => document.getElementById(next.amount ? 'wa' : next.address ? 'wd' : 'wc')?.focus(), 60);
      return;
    }

    setErrors({});
    setBusy(true);
    const base = wd;
    mutate({
      ...base,
      withdrawn: base.withdrawn + wq.btc,
      svcSince: Date.now(),
      history: [
        {
          kind: 'withdrawal',
          status: 'pending',
          label: `Withdrawal · ${A.sym}`,
          date: 'Just now',
          amount: `-${coinAmt.toFixed(A.dec)}`,
          coin: A.sym,
          net: N.short,
          fee: `${wq.netFee} ${A.sym}${wq.swapUsd ? ` + $${formatUsd(wq.swapUsd)} swap` : ''}${wq.svcUsd ? ` + $${formatUsd(wq.svcUsd)} service` : ''}`,
        },
        ...base.history,
      ],
    });

    try {
      const body = { asset, net, amount: coinAmt, address: address.trim(), ...(typed ? { code: typed } : {}) };
      // One key per request that stays the same until it goes through: a retry after a lost answer repeats that withdrawal instead of making a second one.
      const sig = JSON.stringify(body);
      if (wdKey.current?.sig !== sig) wdKey.current = { sig, key: uid() };
      await post('/api/wallet/withdraw', body, wdKey.current.key);
      wdKey.current = null;
      refresh().catch(() => {});
      triggerHaptic('success');
      setAmount('');
      setAddress('');
      setCode('');
      setWStep(1);
      setTgWait(false);
      setShowCode(false);
      setMailPop(false);
      show(t('wal.requested'));
    } catch (e) {
      mutate(base);
      refresh().catch(() => {});
      triggerHaptic('error');
      const msg = e.status ? e.message : t('common.noConnection');
      if (e.field === 'code' && !tf && (e.via === 'email' || mailPop)) {
        if (e.via === 'email') {
          setMailPop(true); // the code went to the email: the pop-up asks for it
          setMailAt(Date.now());
          setErrors({});
        } else {
          setErrors({ code: msg });
        }
        return;
      }
      if (e.field === 'code' && !tf && !code.trim()) {
        setTgWait(true); // the code went to Telegram: wait for the Accept tap, no error text
        return;
      }
      if (e.field === 'code' && !tf) {
        setShowCode(true);
        setTimeout(() => document.getElementById('wc')?.focus(), 50);
      }
      if (e.field !== 'address' && e.field !== 'code') setWStep(1);
      setErrors({ [e.field === 'address' ? 'address' : e.field === 'code' ? 'code' : 'amount']: msg });
    } finally {
      setBusy(false);
    }
  }

  const sMin = ceilTo(minUsd, 2);
  const sMax = Math.max(floorTo((liveAvailable.current || available) * btcUsd, 2), sMin);
  const sVal = Math.min(Math.max(parsed > 0 ? parsed : sMin, sMin), sMax);

  // Next step of the withdraw flow; the amount is checked before the coin step.
  function wNext() {
    if (wStep === 1) {
      const usd = parsed;
      let m = '';
      if (!(usd > 0)) m = t('wal.errAmount');
      else if (usd < minUsd - 0.01) m = t('wal.errMin', { min: minText });
      else if (usd > (liveAvailable.current || available) * btcUsd * (1 + 1e-9) + 1e-9) m = t('wal.errMore');
      if (m) {
        triggerHaptic('error');
        setErrors({ amount: m });
        document.getElementById('wa')?.focus();
        return;
      }
    }
    triggerHaptic('selection');
    setErrors({});
    setWStep(wStep + 1);
  }

  wdRef.current = withdraw;

  function copy() {
    triggerHaptic('success');
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(N.address);
    }
    show(t('wal.copied'));
  }

  return (
    <>
      <style>{WALLET_CSS}</style>
      <PageHead title={t('nav.wallet')} icon="wallet" />
      <div className="grid">
        <div ref={heroRef} className={`card hero slim whero${heroSeen ? '' : ' wpause'}`}>
          <i className="wshine" aria-hidden="true" />
          <span className="mute eyebrow">{t('wal.avail')}</span>
          <WalletBalance wd={wd} dailyUsd={dailyUsd} btcUsd={btcUsd} liveRef={liveAvailable} t={t} />
        </div>

        <PendingCards show={show} />

        {rein && (
          <Link href={reinvestHref(rein)} className="card rein">
            <div>
              <b>{reinvestTitle(rein, t)}</b>
              <small>
                {t('dash.reinLine', { price: formatUsd(rein.plan.price), days: rein.plan.days, daily: rein.plan.daily })}
                {rein.left >= 1 ? ` · ${t('dash.left', { n: formatUsd(rein.left) })}` : ''}
              </small>
            </div>
            <span className="rgo">{t('dash.review')}</span>
          </Link>
        )}

        <div className="grid wal">
          <div className="card wcard">
            <div className="tabs" role="group" aria-label={t('wal.aria')}>
              <button type="button" aria-pressed={tab === 'withdraw'} onClick={() => handleTabChange('withdraw')}>
                {t('wal.withdraw')}
              </button>
              <button type="button" aria-pressed={tab === 'deposit'} onClick={() => handleTabChange('deposit')}>
                {t('wal.deposit')}
              </button>
            </div>

            {tab === 'deposit' && !cryptoOn && <Picker asset={asset} net={net} onAsset={pickAsset} onNet={pickNet} />}

            {tab === 'withdraw' ? (
              <div>
                {wStep > 1 && (
                  <button type="button" className="wback" aria-label={t('dep.back')} onClick={() => { triggerHaptic('light'); setErrors({}); setWStep(wStep - 1); }}>
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
                  </button>
                )}
                <div className="wstep" key={wStep}>
                {wStep === 1 && (
                <div>
                <Field id="wa" label={t('wal.amount')} error={errors.amount}>
                  <input
                    id="wa"
                    inputMode="decimal"
                    className={errors.amount ? 'bad' : undefined}
                    aria-invalid={!!errors.amount}
                    aria-describedby={errors.amount ? 'wa-err' : undefined}
                    placeholder={(0).toFixed(dec)}
                    value={amount}
                    onChange={(e) => {
                      setAmount(e.target.value);
                      if (errors.amount) setErrors({ ...errors, amount: undefined });
                    }}
                  />
                </Field>
                <input
                  type="range"
                  className="wrange"
                  aria-label={t('wal.amount')}
                  min={sMin}
                  max={sMax}
                  step={0.01}
                  value={sVal}
                  style={{ '--f': sMax > sMin ? (sVal - sMin) / (sMax - sMin) : 1 }}
                  onChange={(e) => {
                    setAmount(parseFloat(e.target.value).toFixed(2));
                    if (errors.amount) setErrors({ ...errors, amount: undefined });
                  }}
                />
                <div className="pct-row">
                  {[0.25, 0.5, 0.75, 1].map((p) => (
                    <button key={p} type="button" className="pct-btn" onClick={() => setFraction(p)}>
                      {p === 1 ? t('wal.max') : `${p * 100}%`}
                    </button>
                  ))}
                </div>
                <p className="fine winfo">{t('wal.minOnly', { min: minText })}</p>

                <button className="btn" type="button" onClick={wNext} disabled={!ready}>{t('dep.pickCoin')}</button>
                </div>
                )}

                {wStep === 2 && (
                <div>
                  <Picker asset={asset} net={net} onAsset={pickAsset} onNet={pickNet} fill />
                  <p className="fine winfo">{t('wal.hint', { min: minText, fee: asset === 'btc' ? t('wal.feeFlat', { flat: flatFee, sym: A.sym }) : t('wal.feeSwap', { n: SWAP_FEE_PCT, flat: flatFee, sym: A.sym }) })}</p>
                  <button className="btn" type="button" onClick={wNext}>{t('wal.addr', { sym: A.sym })}</button>
                </div>
                )}

                {wStep === 3 && (
                <div>
                <Field id="wd" label={A.nets && Object.keys(A.nets).length > 1 ? t('wal.addrNet', { sym: A.sym, net: N.short }) : t('wal.addr', { sym: A.sym })} error={errors.address}>
                  <input
                    id="wd"
                    className={errors.address ? 'bad' : undefined}
                    aria-invalid={!!errors.address}
                    aria-describedby={errors.address ? 'wd-err' : undefined}
                    placeholder={net === 'btc' ? 'bc1q…' : net === 'ton' ? 'UQ…' : '0x…'}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck="false"
                    value={address}
                    onChange={(e) => {
                      setAddress(e.target.value);
                      if (errors.address) setErrors({ ...errors, address: undefined });
                    }}
                  />
                </Field>

                <div className={q ? 'quote' : 'fine winfo'} aria-live="polite">
                  {q ? (
                    <>
                      <div className="row">
                        <span className="mute">{t('wal.amount')}</span>
                        <b>{usdMode ? `≈ ${coinAmt.toFixed(A.dec)} ${A.sym}` : `≈ $${formatUsd(q.usd)}`}</b>
                      </div>
                      {asset !== 'btc' && (
                        <div className="row">
                          <span className="mute">{t('wal.swapFee', { n: SWAP_FEE_PCT })}</span>
                          <b>${formatUsd(q.swapUsd)}</b>
                        </div>
                      )}
                      {svcPct > 0 && (
                        <div className="row">
                          <span className="mute">{t('wal.svcFee', { n: svcPct })}</span>
                          <b>−${formatUsd(q.svcUsd)}</b>
                        </div>
                      )}
                      <div className="row">
                        <span className="mute">{t('wal.netFee')}</span>
                        <b>{q.netFee} {A.sym} · ${formatUsd(q.netFeeUsd)}</b>
                      </div>
                      <div className="row total">
                        <span className="mute">{t('wal.receive')}</span>
                        <b style={{ textAlign: 'end' }}>
                          {q.receive > 0 ? `≈ ${floorCoin(asset, q.receive).toFixed(A.dec)} ${A.sym}` : '—'}
                          {q.receive > 0 && <small className="mute" style={{ display: 'block', fontWeight: 400 }}>≈ ${formatUsd(q.receiveUsd)}</small>}
                        </b>
                      </div>
                    </>
                  ) : (
                    t('wal.hint', { min: minText, fee: asset === 'btc' ? t('wal.feeFlat', { flat: flatFee, sym: A.sym }) : t('wal.feeSwap', { n: SWAP_FEE_PCT, flat: flatFee, sym: A.sym }) })
                  )}
                </div>

                {tier && <p className="fine" style={{ margin: '6px 0 10px' }}>{serviceLine(tier, t)}</p>}
                {goal && goal.daysToFree > 0 && (
                  <div style={{ margin: '-4px 0 12px' }}>
                    <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={goal.pct} style={{ height: '6px', borderRadius: '3px', background: '#3d3519', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${Math.max(2, goal.pct)}%`, background: '#e8b84a', borderRadius: '3px' }} />
                    </div>
                    <p className="fine" style={{ margin: '4px 0 0' }}>{t('svc.goal', { d: goal.daysToFree === 1 ? t('svc.day1') : t('svc.dayN', { n: goal.daysToFree }) })}</p>
                  </div>
                )}

                {(tf || showCode) && (
                  <Field id="wc" label={tf ? t('wal.code') : t('wal.codeTg')} error={errors.code}>
                    <input
                      id="wc"
                      className={errors.code ? 'bad' : undefined}
                      aria-invalid={!!errors.code}
                      aria-describedby={errors.code ? 'wc-err' : undefined}
                      placeholder="123456"
                      autoComplete="one-time-code"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck="false"
                      value={code}
                      onChange={(e) => {
                        setCode(e.target.value);
                        if (errors.code) setErrors({ ...errors, code: undefined });
                      }}
                    />
                  </Field>
                )}

                {!tf && <p className="fine" style={{ margin: '0 0 10px' }}>{t('wal.codeNote')}</p>}
                <button className="btn" type="button" onClick={withdraw} disabled={busy || !ready}>
                  {busy ? t('wal.sending') : t('wal.withdraw')}
                </button>
                </div>
                )}
                </div>
              </div>
            ) : cryptoOn && dod?.multi ? (
              <>
                {dod?.event && (
                  <p className="fine" style={{ margin: '0 0 12px', padding: '10px 12px', borderRadius: 12, border: '1px solid #e8b84a', background: 'rgba(232,184,74,.08)' }}>
                    {t('wal.evBanner', { n: dod.event.perUsd, p: dod.event.price, d: dayText(dod.event.endsAt, lang) })}
                  </p>
                )}
                <DepositFlow minDep={minDep} ready={ready} show={show} refreshDod={refreshDod} onCancel={cancelDep} orders={depPending} allOrders={dod?.orders} />
              </>
            ) : cryptoOn ? (
              <div>
                {dod?.multi && <CoinPicker value={payCoin} onChange={setPayCoin} disabled={busy} />}
                <Field id="du" label={t('wal.depUsd')} error={depErr}>
                  <input
                    id="du"
                    inputMode="decimal"
                    className={depErr ? 'bad' : undefined}
                    aria-invalid={!!depErr}
                    aria-describedby={depErr ? 'du-err' : undefined}
                    placeholder="0.00"
                    value={depUsd}
                    onChange={(e) => {
                      setDepUsd(e.target.value);
                      if (depErr) setDepErr('');
                    }}
                  />
                </Field>
                <p className="fine" style={{ margin: '6px 0 10px' }}>{t('wal.depNote', { n: minDep })}</p>
                <button className="btn" type="button" onClick={startDeposit} disabled={busy || !ready}>
                  {t('wal.depPay')}
                </button>
                {depPending.map((o) => (
                  <div key={o.id} className="row" style={{ marginTop: 12, gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: '13.5px' }}>{t('wal.depOrder', { n: formatUsd(o.usd) })}</div>
                      {o.url ? <small style={{ overflowWrap: 'anywhere' }}>{t('wal.depWait')}</small> : <PayInfo order={o} show={show} />}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {o.url && <a className="btn ghost" href={o.url}>{t('wal.depOpen')}</a>}
                      <button className="btn ghost" type="button" onClick={() => cancelDep(o.id)}>{t('wal.depCancel')}</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div>
                <DepositQr value={`${N.uri}${N.address}`} />
                <div className="addr" style={{ margin: '0 0 10px' }}>{N.address}</div>
                <button className="btn ghost" type="button" onClick={copy}>{t('wal.copy')}</button>
                <p className="fine" style={{ textAlign: 'center', margin: '8px 0 0' }}>
                  {t('wal.depInfo', { sym: A.sym, net: N.label, c: N.confirms === 1 ? t('wal.confirm1') : t('wal.confirmN', { n: N.confirms }), m: minDep })}
                </p>

                <Field id="da" label={t('wal.sendAmt')} className="unit" side={<UnitSwitch sym={A.sym} unit={unit} onUnit={pickUnit} />}>
                  <input
                    id="da"
                    inputMode="decimal"
                    placeholder={(0).toFixed(dec)}
                    value={dep}
                    onChange={(e) => setDep(e.target.value)}
                  />
                </Field>
                <div className={dq ? 'quote' : 'fine winfo'} aria-live="polite">
                  {dq ? (
                    <>
                      <div className="row">
                        <span className="mute">{t('wal.youSend')}</span>
                        <b>{usdMode ? `≈ ${depCoin.toFixed(A.dec)} ${A.sym}` : `≈ $${formatUsd(dq.usd)}`}</b>
                      </div>
                      {asset !== 'btc' && (
                        <div className="row">
                          <span className="mute">{t('wal.swapFee', { n: SWAP_FEE_PCT })}</span>
                          <b>${formatUsd(dq.swapUsd)}</b>
                        </div>
                      )}
                      <div className="row total">
                        <span className="mute">{t('wal.credited')}</span>
                        <b style={{ textAlign: 'end' }}>
                          ≈ {formatBtc(dq.creditedBtc)} BTC
                          <small className="mute" style={{ display: 'block', fontWeight: 400 }}>≈ ${formatUsd(dq.creditedUsd)}</small>
                        </b>
                      </div>
                      {dq.usd < minDep - 0.01 && (
                        <p className="fine" role="alert" style={{ margin: '8px 0 0' }}>{t('wal.below', { n: minDep })}</p>
                      )}
                    </>
                  ) : (
                    t('wal.depHint', { n: minDep, fee: asset === 'btc' ? t('wal.noFee') : t('wal.swapFeeN', { n: SWAP_FEE_PCT }) })
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="card">
            <div className="cardhead" style={{ marginBottom: open ? 8 : 0 }}>
              <button
                type="button"
                className="collapse"
                aria-expanded={open}
                onClick={() => {
                  triggerHaptic('selection');
                  setOpen(!open);
                }}
              >
                <h3>{t('wal.activity')}</h3>
                <span className="mute">{ready && sameFilter ? (wd.historyTotal ?? history.length) : ''}</span>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
              </button>
            </div>
            {open && (
              <div className="minitabs fill" role="group" aria-label={t('wal.filterAria')}>
                {FILTERS.map(([id, label]) => (
                  <button key={id} type="button" aria-pressed={filter === id} onClick={() => { setFilter(id); setLimit(20); }}>{t(label)}</button>
                ))}
              </div>
            )}
            {open && (loadingRows ? PH_HISTORY : shown).map((h, i) => {
              const k = KIND[h.kind] || KIND.payout;
              const hu = usdOf(h, prices);
              return (
                <div key={`r${i}`} className={`row wrow${i === 0 && h.date === 'Just now' ? ' shareitem' : ''}${loadingRows ? ' ld' : ''}${stale ? ' wstale' : ''}`} style={{ animationDelay: `${i * 50}ms` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span className={`kind ${k.cls}`} aria-hidden="true">{k.glyph}</span>
                    <div>
                      <div style={{ fontWeight: 500, fontSize: '13.5px' }}>{histLabel(h, t)}</div>
                      <small>{[histDate(h, lang, t), h.net !== h.coin ? histNet(h.net, t) : null, h.status ? (STATUS[h.status] ? t(STATUS[h.status]) : h.status) : null].filter(Boolean).join(' · ')}{h.fee ? ` · ${t('wal.feeIs', { fee: histFee(h.fee, t) })}` : ''}</small>
                    </div>
                  </div>
                  <div style={{ textAlign: 'end', fontVariantNumeric: 'tabular-nums' }}>
                    <b className={h.amount.startsWith('+') ? 'up' : ''} style={{ fontSize: '13.5px' }}>
                      {h.amount}{h.coin ? ` ${h.coin}` : ''}
                    </b>
                    {hu != null && <small style={{ display: 'block' }}>≈ ${formatUsd(hu)}</small>}
                  </div>
                </div>
              );
            })}
            {open && shown.length === 0 && ready && sameFilter && <p className="empty">{t('wal.nothing')}</p>}
            {open && wd && sameFilter && history.length < (wd.historyTotal ?? 0) && (
              <button type="button" className="btn ghost" style={{ width: '100%', marginTop: 8 }} onClick={() => setLimit((l) => l + 20)}>{t('wal.showMore')}</button>
            )}
          </div>
        </div>
      </div>
      {!tf && tgWait && !showCode && (
        <div role="dialog" aria-modal="true" aria-labelledby="tgt" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 60, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div className="card" style={{ width: '100%', maxWidth: 320, textAlign: 'center' }}>
            <div style={{ position: 'relative', width: 52, height: 52, margin: '4px auto 12px' }}>
              <span className="tgring" aria-hidden="true" />
              <div style={{ position: 'relative', width: 52, height: 52, borderRadius: '50%', background: '#2AABEE', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M15 10l-4 4l6 6l4 -16l-18 7l4 2l2 6l3 -4" />
                </svg>
              </div>
            </div>
            <b id="tgt" style={{ display: 'block', fontSize: 18, fontWeight: 500 }}>{t('wal.tgTitle')}</b>
            <span className="mute" style={{ display: 'block', margin: '4px 0 14px' }}>{t('wal.tgSub')}</span>
            <a className="btn" href={`https://t.me/${tgBot}`} target="_blank" rel="noopener noreferrer" style={{ background: '#2AABEE', borderColor: '#2AABEE', color: '#fff', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{t('wal.tgOpen')}</a>
            <div className="tgdots" role="status" aria-label={t('wal.tgWait')} style={{ margin: '14px 0 4px' }}><i /><i /><i /></div>
            <button
              type="button"
              onClick={() => {
                setShowCode(true);
                setTimeout(() => document.getElementById('wc')?.focus(), 50);
              }}
              style={{ background: 'none', border: 0, padding: '4px 0', margin: 0, font: 'inherit', fontSize: 13, color: '#9aa6c2', textDecoration: 'underline', cursor: 'pointer' }}
            >
              {t('wal.tgNoCode')}
            </button>
            <button className="btn ghost" type="button" style={{ marginTop: 12 }} onClick={() => { triggerHaptic('light'); setTgWait(false); }}>{t('common.cancel')}</button>
          </div>
        </div>
      )}
      {!tf && mailPop && (
        <div role="dialog" aria-modal="true" aria-labelledby="mlt" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 60, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div className="card" style={{ width: '100%', maxWidth: 320, textAlign: 'center' }}>
            <div style={{ width: 52, height: 52, margin: '4px auto 12px', borderRadius: '50%', background: '#F5A623', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#0b0a08" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 7a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z" />
                <path d="M3 7l9 6l9 -6" />
              </svg>
            </div>
            <b id="mlt" style={{ display: 'block', fontSize: 18, fontWeight: 500 }}>{t('wal.mailTitle')}</b>
            <span className="mute" style={{ display: 'block', margin: '4px 0 14px' }}>{t('wal.mailSub')}</span>
            <div style={{ textAlign: 'start' }}>
              <Field id="wm" label={t('wal.mailCode')} error={errors.code}>
                <input
                  id="wm"
                  className={errors.code ? 'bad' : undefined}
                  aria-invalid={!!errors.code}
                  aria-describedby={errors.code ? 'wm-err' : undefined}
                  placeholder="123456"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value);
                    if (errors.code) setErrors({ ...errors, code: undefined });
                  }}
                />
              </Field>
            </div>
            <button className="btn" type="button" disabled={busy || !code.trim()} onClick={() => withdraw()}>{busy ? t('wal.sending') : t('wal.mailConfirm')}</button>
            {(() => {
              const left = Math.max(0, Math.ceil((mailAt + 60000 - Date.now()) / 1000));
              return (
                <button
                  type="button"
                  disabled={busy || left > 0}
                  onClick={() => {
                    setCode('');
                    setErrors({});
                    withdraw({ resend: true });
                  }}
                  style={{ background: 'none', border: 0, padding: '10px 0 0', margin: 0, font: 'inherit', fontSize: 13, color: '#9aa6c2', textDecoration: left > 0 ? 'none' : 'underline', cursor: left > 0 ? 'default' : 'pointer' }}
                >
                  {left > 0 ? t('wal.mailResendIn', { n: left }) : t('wal.mailResend')}
                </button>
              );
            })()}
            <button className="btn ghost" type="button" style={{ marginTop: 12 }} onClick={() => { triggerHaptic('light'); setMailPop(false); setCode(''); setErrors({}); }}>{t('common.cancel')}</button>
          </div>
        </div>
      )}
      {toast}
    </>
  );
}
