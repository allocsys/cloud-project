'use client';
import PageHead from '@/components/PageHead';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { halls, CUSTOM, customPlan, thFromPos, fmtTh, fmtUsd, BTC_USD, MIN_WITHDRAW_USD } from '@/lib/data';
import { REFUND_HOURS } from '@/lib/rules';
import { useApi, post, revalidate } from '@/lib/api';
import { everyVisible } from '@/lib/visible';
import RigArt, { rigFor } from '@/components/RigArt';
import { AsicsCard, SmartCard } from '@/components/PowerCards';
import BoostCard from '@/components/BoostCard';
import { useToast } from '@/components/Toast';
import { triggerHaptic } from '@/lib/haptics';
import { markDrill, useSheetBack } from '@/lib/nav';
import { posFromTh, SLIDER_SIZES } from '@/lib/reinvest';
import { budgetFromPos, posFromBudget } from '@/lib/tiers';
import { dailyCosts, fmtCost } from '@/lib/fees';
import { liveDaily } from '@/lib/market';
import { SMART, smartPlan, smartBand } from '@/lib/smart';
import { applyFirstBonus, bonusText } from '@/lib/first-bonus';
import { runningNow } from '@/lib/boost';
import { fill, useLang } from '@/components/I18nProvider';
import { pagePath } from '@/lib/i18n/codes';
import { CoinTabs } from '@/components/PaySheet';
import { PendingCards } from '@/components/PendingOrders';
import { DEFAULT_PAY } from '@/lib/pay-coins';

// Icons for the three Plans tabs (outline, 24 grid).
const TAB_ICON = {
  buy: 'M6 19m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M17 19m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M17 17h-11v-14h-2M6 5l14 1l-1 7h-13',
  boost: 'M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11',
  mine: 'M5 5m0 1a1 1 0 0 1 1 -1h12a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-12a1 1 0 0 1 -1 -1zM9 9h6v6h-6zM3 10h2M3 14h2M10 3v2M14 3v2M21 10h-2M21 14h-2M10 21v-2M14 21v-2',
};

const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);


// A closing sheet gives its history step back (history.back) a moment later. The pay sheet adds its own step only after that pop,
// otherwise the late pop closes it again as soon as it opens.
const afterPop = () =>
  new Promise((done) => {
    const end = () => {
      clearTimeout(id);
      window.removeEventListener('popstate', end);
      done();
    };
    const id = setTimeout(end, 500);
    window.addEventListener('popstate', end);
  });

import { useWaiting } from '@/components/Skeleton';
import { PH_MINERS } from '@/lib/placeholder';

export default function Plans() {
  const { t, lang } = useLang();
  // Catalogue and miners come from the cached API: instant from cache, refreshed quietly.
  const { data: cat } = useApi('/api/plans', { ttl: 20000 });
  const { data: md, refresh } = useApi('/api/miners', { ttl: 10000 });
  const { data: wd } = useApi('/api/wallet', { ttl: 10000 });
  const { data: pd } = useApi('/api/prices', { ttl: 30000 });
  const { data: ord, refresh: refreshOrders, quiet: quietOrders } = useApi('/api/orders', { ttl: 10000 });
  const hallMap = cat ? cat.halls : halls;
  // What a plan is expected to pay per day at today's market (the catalogue's static label until the server answers).
  const dailyOf = (p) => {
    if (p.smart) return p.daily;
    const v = liveDaily(p.th, hallMap[p.hall], cat?.live);
    return v === null ? p.daily : `$${v.toFixed(2)}`;
  };
  const list = md ? md.contracts : []; // nothing is shown as a miner until the server has answered
  const nextId = md ? md.nextSerial : '';

  const [sel, setSel] = useState(null);
  const [pos, setPos] = useState(666); // ASICs slider position, about 100 TH/s
  const [aterm, setAterm] = useState(180); // ASICs term
  const [term, setTerm] = useState(120); // Smart Mining term
  const [budget, setBudget] = useState('500'); // Smart Mining budget as typed, in dollars
  const [spos, setSpos] = useState(() => posFromBudget(500)); // Smart Mining slider position
  const [tab, setTab] = useState('buy');
  // The Boost tab is always there, like the other two tabs.
  const { data: bd } = useApi('/api/boost', { ttl: 10000 });
  // The Boost card draws itself in the loading look until /api/boost answers (BoostCard's loading prop), so Buy plans does not flash first.
  // Shimmer placeholders while the first answers are on their way (see components/Skeleton.js).
  const waitCat = useWaiting(!cat);
  const waitMd = useWaiting(!md);
  const waitBd = useWaiting(!bd);
  const view = tab;
  const [dragY, setDragY] = useState(0);
  const [leaving, setLeaving] = useState(false); // the plan sheet is sliding away to hand over to the pay sheet
  const [busy, setBusy] = useState(false);
  const [coinOpen, setCoinOpen] = useState(false); // the coin picker shows once Pay with crypto is tapped
  const [moreOpen, setMoreOpen] = useState(false); // the plan details open when the balance row is tapped
  const [coin, setCoin] = useState(DEFAULT_PAY); // the coin a crypto payment is made in (our own checkout only)
  const [toast, show] = useToast();
  const sheetRef = useRef(null);
  const openerRef = useRef(null);
  const startY = useRef(null);
  const lock = useRef(null); // what the open sheet keeps fixed once everything has loaded: plan, balance and pay options
  const paying = useRef(false); // set at once on a tap, unlike `busy`, which only changes on the next render
  const payKey = useRef(null); // idempotency key of the purchase in progress: { sig, key }
  // The pay buttons wait until the catalogue, miners, wallet and orders have answered (or 4 seconds, if one never does).
  const [slow, setSlow] = useState(false);
  const ready = !!(cat && md && wd && ord) || slow;
  useEffect(() => {
    if (!sel) {
      setSlow(false);
      return undefined;
    }
    const t = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(t);
  }, [sel]);
  // What the two cards show, and what the sheet confirms: the ASICs pick and the Smart Mining pick.
  const bNum = Math.min(SMART.max, Math.max(SMART.min, Math.round(Number(budget)) || SMART.min));
  const ap = customPlan(thFromPos(pos), aterm, hallMap);
  const sp = smartPlan(bNum, term, cat?.smartTable);
  // The balance that can pay for a plan, in USD at the live rate (the server checks again with its own rate).
  const balUsd = wd ? Math.max(0, wd.earned - wd.withdrawn - (wd.spent || 0)) * (pd?.prices?.btc ?? BTC_USD) : 0;
  // The plan on the sheet: Smart Mining or an ASICs pick. Once everything has loaded, the sheet keeps the plan, balance and pay
  // options it opened with, so a price or a button never changes under a finger.
  const liveCur = sel ? (sel.id === 'smart' ? sp : sel.id === 'custom' ? ap : sel) : null;
  if (!sel) lock.current = null;
  else if (ready && !lock.current) lock.current = { plan: liveCur, bal: balUsd, crypto: !!ord?.crypto };
  const cur = sel ? lock.current?.plan || liveCur : null;
  const hall = cur ? hallMap[cur.hall] || null : null;
  const costs = cur && hall ? dailyCosts(cur.th, hall) : null; // already taken out of the mining, never billed
  // Smart Mining: the profit a day is held between the bottom and the top of the reserve band (lib/smart.js), so the term's profit
  // is estimated as that band over the whole term. An estimate, not a promise: a weak market can pay less, a strong one more.
  const money = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const profitRange = cur?.smart ? smartBand(cur) : null; // { low, mid, high } from lib/smart.js
  const sheetBal = lock.current ? lock.current.bal : balUsd;
  const canBal = !!cur && sheetBal >= cur.price;
  const crypto = lock.current ? lock.current.crypto : !!ord?.crypto;
  const methods = canBal ? ['balance', ...(crypto ? ['crypto'] : [])] : crypto ? ['crypto'] : ['balance'];
  // The first-buy bonus is shown when crypto is the only way to pay (a first buy from the balance gets none).
  const fb = cur && md?.firstBonus && crypto && !canBal ? applyFirstBonus(md.firstBonus, cur) : null;

  // Smart Mining amount box and slider keep each other in step.
  const onAmount = (v) => {
    setBudget(v);
    const n = Math.round(Number(v));
    if (Number.isFinite(n) && n >= SMART.min) setSpos(posFromBudget(n));
  };
  const onAmountBlur = () => {
    setBudget(String(bNum));
    setSpos(posFromBudget(bNum));
  };
  const onSlide = (v) => {
    setSpos(v);
    setBudget(String(budgetFromPos(v)));
  };

  function selectPlan(p) {
    triggerHaptic('selection');
    openerRef.current = document.activeElement;
    payKey.current = null;
    setCoinOpen(false);
    setMoreOpen(false);
    setSel(p);
  }

  // Close the sheet and give focus back to the button that opened it.
  function dismiss() {
    setSel(null);
    setLeaving(false);
    setDragY(0);
    startY.current = null;
    payKey.current = null;
    const el = openerRef.current;
    if (el && el.focus) el.focus();
  }

  function closeModal() {
    triggerHaptic('light');
    dismiss();
  }

  const pending = (ord?.orders || []).filter((o) => o.status === 'pending');
  const review = (ord?.orders || []).filter((o) => o.status === 'review');

  // Pays by the chosen method. Balance and the demo account activate at once; crypto leaves for the payment page.
  async function pay(method) {
    if (paying.current || busy || !ready) return;
    paying.current = true;
    const plan = cur;
    setBusy(true);
    let leaving = false;
    try {
      const body = plan.smart
        ? { planId: 'smart', budget: plan.budget, days: plan.days, pay: method }
        : plan.id === 'custom'
          ? { planId: 'custom', th: plan.th, days: plan.days, pay: method }
          : { planId: plan.id, pay: method };
      if (method === 'crypto' && ord?.multi) {
        body.asset = coin.asset;
        body.network = coin.net;
      }
      // One key per plan, size, term, coin and method: a retry after a lost answer repeats the same purchase instead of making a second one.
      const sig = JSON.stringify(body);
      if (payKey.current?.sig !== sig) payKey.current = { sig, key: uid() };
      const r = await post('/api/plans/buy', body, payKey.current.key);
      if (r.pending && r.order?.url) {
        leaving = true;
        window.location.assign(r.order.url);
        return;
      }
      if (r.pending && r.order?.address) {
        await refreshOrders().catch(() => {});
        // Hand over: the plan sheet slides down, goes, and only then the pay sheet slides up and stays open.
        setLeaving(true);
        await new Promise((done) => setTimeout(done, 200));
        const popped = afterPop();
        dismiss();
        await popped;
        window.dispatchEvent(new CustomEvent('vtx-pay-open', { detail: { id: r.order.id } }));
        return;
      }
      await refresh().catch(() => {});
      triggerHaptic('success');
      show(plan.smart ? t('plans.smartStarted') : plan.id === 'custom' ? t('plans.asicsActivated') : t('plans.planActivated', { name: plan.name }));
      dismiss();
    } catch (e) {
      triggerHaptic('error');
      show(e.status ? e.message : t('common.noConnection'));
      if (!e.status) refresh().catch(() => {}); // the answer may have been lost after the purchase went through: look
    } finally {
      if (!leaving) {
        paying.current = false;
        setBusy(false);
        revalidate('/api/wallet').catch(() => {});
        refreshOrders().catch(() => {});
      }
    }
  }

  async function cancelOrder(id) {
    triggerHaptic('light');
    try {
      await post('/api/orders/cancel', { id });
    } catch (e) {
      show(e.status ? e.message : t('common.noConnection'));
    }
    refreshOrders().catch(() => {});
  }

  // While a payment is open, check for it every few seconds. When one turns paid, say so and refresh the miners.
  const seen = useRef(new Set());
  useEffect(() => {
    if (!pending.length) return undefined;
    return everyVisible(() => quietOrders().catch(() => {}), 5000);
  }, [pending.length]);
  useEffect(() => {
    if (!ord) return;
    const ids = new Set(pending.map((o) => o.id));
    for (const id of seen.current) {
      if (!ids.has(id) && ord.orders.find((o) => o.id === id)?.status === 'paid') {
        triggerHaptic('success');
        show(t('plans.paid'));
        refresh().catch(() => {});
        revalidate('/api/wallet').catch(() => {});
      }
    }
    seen.current = ids;
  }, [ord]);

  useSheetBack(!!sel, dismiss);

  // Back from the payment page can restore this page exactly as it was left (sheet open, buttons disabled): free it and show the open order.
  useEffect(() => {
    const back = (e) => {
      if (!e.persisted) return;
      paying.current = false;
      setBusy(false);
      dismiss();
      refreshOrders().catch(() => {});
    };
    window.addEventListener('pageshow', back);
    return () => window.removeEventListener('pageshow', back);
  }, []);

  // Coming back from a miner page, or from the Boost card on the landing page: reopen on that tab.
  useEffect(() => {
    try {
      const t = sessionStorage.getItem('vtx-plans-tab');
      if (t === 'mine' || t === 'boost') {
        sessionStorage.removeItem('vtx-plans-tab');
        setTab(t);
      }
    } catch {}
  }, []);

  // Coming from a Reinvest card or the calculator: /plans?plan=<id> opens that plan's sheet once the catalogue has loaded.
  // /plans?plan=custom&th=24&days=180 sets the ASICs card to that size and term and opens its sheet.
  // /plans?plan=smart&budget=500&days=120 does the same for Smart Mining.
  const deepPlan = useRef(null);
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      const id = q.get('plan');
      if (id) {
        deepPlan.current = { id, th: parseFloat(q.get('th')), days: parseInt(q.get('days'), 10), budget: parseInt(q.get('budget'), 10) };
        window.history.replaceState(null, '', window.location.pathname);
      }
    } catch {}
  }, []);
  useEffect(() => {
    if (!deepPlan.current || !cat) return;
    const { id, th, days, budget: b } = deepPlan.current;
    deepPlan.current = null;
    if (id === 'smart') {
      setTab('buy');
      if (Number.isInteger(b)) {
        const n = Math.min(SMART.max, Math.max(SMART.min, b));
        setBudget(String(n));
        setSpos(posFromBudget(n));
      }
      if (SMART.terms.includes(days)) setTerm(days);
      setSel({ id: 'smart' });
      return;
    }
    if (id === 'custom') {
      setTab('buy');
      if (SLIDER_SIZES.includes(th)) setPos(posFromTh(th));
      if (CUSTOM.terms.includes(days)) setAterm(days);
      setSel({ id: 'custom' });
    }
  }, [cat]);

  function openMiner() {
    try {
      sessionStorage.setItem('vtx-plans-tab', 'mine');
    } catch {}
    markDrill();
  }

  // While the sheet is open: Escape closes, Tab stays inside, page behind does not scroll.
  useEffect(() => {
    if (!sel) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeModal();
      } else if (e.key === 'Tab') {
        const f = sheetRef.current ? sheetRef.current.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])') : [];
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
  }, [sel]);

  return (
    <>
      <PageHead title={t('nav.plans')} icon="plans" />

      <div className="ptabs" role="group" aria-label={t('plans.aria')}>
        {[
          ['buy', t('plans.buy'), 0],
          ['boost', t('boost.title'), bd?.free > 0 ? bd.free : 0],
          ['mine', t('plans.myMiners'), md ? list.length : 0],
        ].map(([k, label, n]) => (
          <button key={k} type="button" aria-pressed={view === k} aria-label={n ? `${label} · ${n}` : label} onClick={() => setTab(k)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d={TAB_ICON[k]} /></svg>
            <span>{label}</span>
            {n > 0 && <b>{n}</b>}
          </button>
        ))}
      </div>

      {view === 'buy' && <PendingCards show={show} poll={false} />}

      {view === 'buy' && [...pending.filter((o) => !o.address), ...review].map((o) => (
        <div key={o.id} className="card">
          <div className="row" style={{ borderTop: 0 }}>
            <div>
              <b>{o.status === 'review' ? t('plans.needCheck') : t('plans.waiting')}</b>
              <small style={{ display: 'block' }}>{o.label} · ${fmtUsd(o.usd)}</small>
            </div>
            {o.status === 'pending' && (
              <div>
                {o.url && <a className="linkbtn" href={o.url} style={{ display: 'inline-flex', alignItems: 'center' }}>{t('plans.pay')}</a>}
                <button type="button" className="linkbtn" onClick={() => cancelOrder(o.id)}>{t('common.cancel')}</button>
              </div>
            )}
          </div>
        </div>
      ))}

      {view === 'boost' ? (
        <BoostCard show={show} loading={!bd && waitBd} />
      ) : view === 'buy' ? (
      <div className={waitCat ? 'ld' : undefined} aria-busy={waitCat || undefined} style={{ display: 'contents' }}>
      {cat?.smartOn !== false && (
        <SmartCard
          budget={budget}
          bNum={bNum}
          spos={spos}
          term={term}
          setTerm={setTerm}
          plan={sp}
          table={cat?.smartTable}
          within={balUsd >= sp.price}
          onAmount={onAmount}
          onAmountBlur={onAmountBlur}
          onSlide={onSlide}
          onBuy={() => selectPlan({ id: 'smart' })}
          boosts={runningNow(bd)}
          onBoosts={() => setTab('boost')}
        />
      )}
      <AsicsCard
        pos={pos}
        setPos={setPos}
        term={aterm}
        setTerm={setAterm}
        plan={ap}
        daily={dailyOf(ap)}
        hall={hallMap[ap.hall] || null}
        within={balUsd >= ap.price}
        onBuy={() => selectPlan({ id: 'custom' })}
      />
      </div>
      ) : list.length || (!md && waitMd) ? (
        <div className={md ? 'clist' : 'clist ld'} aria-busy={!md || undefined}>
          {(md ? list : PH_MINERS).map((c) => {
            const pct = Math.round((c.elapsed / c.days) * 100);
            const rig = rigFor(c);
            return (
              <Link key={c.serial} href={`/miners/${c.serial}`} onClick={openMiner} className="card cl">
                <div className="crow">
                  <RigArt units={rig.units} speed={rig.speed} id={c.serial} />
                  <div className="mi">
                    <div className="mt">
                      <i className={`sdot${c.online && !c.paused ? '' : ' off'}`} />
                      <b>{c.plan}</b>
                      <svg className="go" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
                    </div>
                    <div className="sline">
                      <span className="serial">{c.serial}</span>
                      {c.smart && c.coin && !c.paused && <small className="mcoin">{c.coin}</small>}
                      {c.paused && <small className="mcoin off">{t('plans.pausedToday')}</small>}
                    </div>
                    <div className="mchips">
                      <span>{c.smart ? t('plans.budgetN', { n: fmtUsd(c.budget) }) : `${c.th} TH/s`}</span>
                      <span>{c.smart ? t('plans.bestCoin') : hallMap[c.hall].efficiency}</span>
                      {c.paused ? <span>{t('plans.pausedToday')}</span> : <span className="up">+${c.dailyUsd.toFixed(2)}/{t('calc.day')}</span>}
                    </div>
                  </div>
                </div>
                <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                  <i style={{ width: `${pct}%` }} />
                </div>
                <div className="cmeta">
                  <span>{t('plans.dayOf', { e: c.elapsed, d: c.days })}</span>
                  <span>{t('plans.ends', { x: c.ends })}</span>
                </div>
              </Link>
            );
          })}
        </div>
      ) : md ? (
        <div className="card">
          <p className="empty">{t('plans.noMiners')}</p>
          <button className="swap" onClick={() => setTab('buy')}>{t('plans.buyOne')}</button>
        </div>
      ) : null}

      {sel && (
        <div
          className={leaving ? 'sheet leaving' : 'sheet'}
          role="dialog"
          aria-modal="true"
          aria-labelledby="st"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div
            className="card pinned"
            ref={sheetRef}
            style={dragY ? { transform: `translateY(${dragY}px)`, transition: 'none' } : undefined}
            onTouchStart={(e) => {
              startY.current = e.target.closest?.('.sheetscroll')?.scrollTop > 0 ? null : e.touches[0].clientY;
            }}
            onTouchMove={(e) => {
              if (startY.current === null) return;
              setDragY(Math.max(0, e.touches[0].clientY - startY.current));
            }}
            onTouchEnd={() => {
              if (dragY > 90) closeModal();
              else setDragY(0);
              startY.current = null;
            }}
          >
            <div className="sheetscroll">
            <div className="grab" aria-hidden="true" />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <h3 id="st">{cur.smart ? t('dash.smart') : cur.id === 'custom' ? 'ASICs' : t('plans.planName', { name: cur.name })}</h3>
                <p className="mute" style={{ fontSize: '13px', margin: '4px 0 0' }}>
                  {cur.smart
                    ? t('plans.smartLine', { n: fmtUsd(cur.budget), d: cur.days })
                    : cur.id === 'custom'
                      ? t('plans.asicsLine', { th: fmtTh(cur.th), d: cur.days })
                      : cur.blurb}
                </p>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <b style={{ display: 'block', color: 'var(--gold2)', fontSize: '28px', lineHeight: 1 }}>${fmtUsd(cur.price)}</b>
                <small className="mute" style={{ fontSize: '12px' }}>{t('plans.due')}</small>
              </div>
            </div>
            <div className="sheetbody">
              {hall ? (
                <>
                  <div className="row">
                    <span className="mute">{t('dash.hall')}</span>
                    <b className="v">{hall.name}<small>{hall.power}</small></b>
                  </div>
                  <div className="row">
                    <span className="mute">{t('plans.rig')}</span>
                    <b className="v">{hall.rig}<small>{hall.efficiency}</small></b>
                  </div>
                </>
              ) : null}
              {costs ? (
                <div className="row">
                  <span className="mute">{t('plans.fees', { n: fmtCost(costs.elec + costs.maint) })}</span>
                  <small className="mute">{t('plans.taken')}</small>
                </div>
              ) : null}
              {fb && (
                <div className="row">
                  <span className="mute">{t('plans.firstBonus')}</span>
                  <b className="v" style={{ color: 'var(--green)' }}>{t('plans.bonusLine', { b: bonusText(fb.bonus) })}<small>{t('plans.fullTerm')}</small></b>
                </div>
              )}
              <button type="button" className="row" aria-expanded={moreOpen} onClick={() => { triggerHaptic('selection'); setMoreOpen((v) => !v); }} style={{ width: '100%', background: 'none', border: 0, color: 'inherit', font: 'inherit', textAlign: 'inherit', cursor: 'pointer' }}>
                <span className="mute">{t('plans.balance')}</span>
                <b className="v" style={canBal ? undefined : { color: 'var(--red, #ff8a80)' }}>${fmtUsd(sheetBal)} <span aria-hidden="true" className="mute">{moreOpen ? '\u25B4' : '\u25BE'}</span></b>
              </button>
            </div>
            {ready && !canBal && (
              <p className="fine" style={{ margin: '4px 0 0' }}>
                {!crypto
                  ? t('plans.noBalance')
                  : t('plans.short', { n: fmtUsd(cur.price - sheetBal) })}
              </p>
            )}
            {moreOpen && (
            <div className="unfold" style={{ margin: '8px 0 12px' }}>
            <div className="sheetbody">
              <div className="row">
                <span className="mute">{t('dash.perDayCap')}</span>
                <b className="v">~{dailyOf(cur)}/{t('calc.day')}</b>
              </div>
              {profitRange && (
                <div className="row">
                  <span className="mute">{t('plans.profit')}</span>
                  <b className="v" style={{ color: 'var(--green)' }}>{t('plans.about', { n: money(profitRange.mid) })}<small>{t('plans.range', { a: money(profitRange.low), b: money(profitRange.high) })}</small></b>
                </div>
              )}
              {profitRange && (
                <div className="row">
                  <span className="mute">{t('plans.totalEnd')}</span>
                  <b className="v">{t('plans.about', { n: money(cur.budget + profitRange.mid) })}<small>{t('plans.budgetProfit')}</small></b>
                </div>
              )}
            </div>
            <p className="fine" style={{ margin: '8px 0 0' }}>
              {fill(t('plans.fine', { n: cat?.minWithdraw ?? MIN_WITHDRAW_USD }), { terms: <Link href={pagePath('/terms', lang)}>{t('auth.terms')}</Link> })}
              {' '}{t('refund.badge', { hours: REFUND_HOURS })}{' '}<Link href={pagePath('/refunds', lang)}>{t('refund.more')}</Link>
            </p>
            </div>
            )}
            </div>
            <div className="sheetfoot">
            {ready && ord?.multi && methods.includes('crypto') && coinOpen && (
              <div className="unfold"><CoinTabs value={coin} onChange={setCoin} disabled={busy} /></div>
            )}
            {!ready ? (
              <button className="btn" type="button" disabled>{t('plans.loading')}</button>
            ) : (
              methods.map((m, i) => (
                <button key={m} className={i === 0 ? 'btn' : 'swap'} autoFocus={i === 0} onClick={() => (m === 'crypto' && ord?.multi && !coinOpen ? setCoinOpen(true) : pay(m))} disabled={busy || (m === 'balance' && !canBal)}>
                  {m === 'balance' ? t('plans.payBalanceAmt', { n: fmtUsd(cur.price) }) : t('plans.payCrypto')}
                </button>
              ))
            )}
            </div>
          </div>
        </div>
      )}
      {toast}
    </>
  );
}
