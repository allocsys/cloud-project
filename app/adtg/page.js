'use client';
// View-only screen for reviewers (accounts the admin adds in Settings, Reviewers). It reads GET /api/adtg and has no buttons that change anything.
import { useCallback, useEffect, useState } from 'react';
import { fmtTh } from '@/lib/data';
import MarkIcon from '@/components/MarkIcon';

async function call(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  let j = {};
  try {
    j = await r.json();
  } catch {}
  return { ...j, status: r.status };
}

const SM = { width: 'auto', margin: 0, padding: '0 12px', minHeight: 36 };
const when = (t) => (t ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const ORDER = { pending: 'Waiting', review: 'Needs a check', paid: 'Paid', cancelled: 'Closed', expired: 'Expired', failed: 'Failed' };
const WD = { pending: 'Needs approval', approved: 'Approved, to pay', sent: 'Sent', failed: 'Failed, refunded', rejected: 'Rejected, refunded' };
const RR = { pending: 'Needs a decision', approved: 'Refunded', rejected: 'Declined' };
const RR_WHY = { mistake: 'Bought by mistake', wrong: 'Wrong plan or amount', low: 'Returns look too low', better: 'Found a better option', money: 'Needs the money back', broken: 'Something did not work', other: 'Other' };
const RR_AGAIN = { yes: 'Yes', maybe: 'Maybe', no: 'No' };
const KYC = { none: 'Not verified', pending: 'Pending review', verified: 'Verified' };
const orderOpen = (o) => o.status === 'review' || o.status === 'pending';
const wdOpen = (w) => w.status === 'pending' || w.status === 'approved';
const rrOpen = (r) => r.status === 'pending';

const Pill = ({ tone, children }) => <span className={`adm-pill${tone ? ` ${tone}` : ''}`}>{children}</span>;

function Fold({ title, sub, pill, start, children }) {
  const [open, setOpen] = useState(!!start);
  return (
    <div className="card adm-fold" data-open={open}>
      <button type="button" className="adm-fh" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>
          <span className="adm-ft">{title}</span>
          {sub && <small>{sub}</small>}
        </span>
        {pill}
        <i aria-hidden="true" />
      </button>
      {open && <div className="adm-fb">{children}</div>}
    </div>
  );
}

function Stat({ l, v, s }) {
  return (
    <div className="stat">
      <span>{l}</span>
      <b>
        {v}
        {s && <small>{s}</small>}
      </b>
    </div>
  );
}

function Filter({ value, onPick, open, all }) {
  return (
    <div className="minitabs adm-filter" role="group" aria-label="Filter">
      <button aria-pressed={value === 'open'} onClick={() => onPick('open')}>Open · {open}</button>
      <button aria-pressed={value === 'all'} onClick={() => onPick('all')}>All · {all}</button>
    </div>
  );
}

function Login({ onDone }) {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (busy || !user || !pass) return;
    setBusy(true);
    setErr('');
    try {
      const r = await call('POST', '/api/adtg/login', { user, pass });
      if (r.ok) onDone();
      else setErr(r.error || 'Could not sign in.');
    } catch {
      setErr('No connection. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div id="auth">
      <form className="authbox" onSubmit={submit}>
        <div className="mark"><MarkIcon /></div>
        <h1>Review</h1>
        <p className="mute">Sign in to continue.</p>
        <div className="field">
          <input id="rvu" autoComplete="username" autoCapitalize="none" spellCheck="false" placeholder=" " className={err ? 'bad' : ''} value={user} onChange={(e) => setUser(e.target.value)} />
          <label htmlFor="rvu">Username</label>
        </div>
        <div className="field" style={{ marginTop: 12 }}>
          <input id="rvp" type="password" autoComplete="current-password" placeholder=" " className={err ? 'bad' : ''} value={pass} onChange={(e) => setPass(e.target.value)} />
          <label htmlFor="rvp">Password</label>
        </div>
        {err && <div className="ferr" role="alert">{err}</div>}
        <button className="btn" style={{ marginTop: 16 }} disabled={busy || !user || !pass}>Sign in</button>
      </form>
    </div>
  );
}

const TABS = [['overview', 'Overview'], ['users', 'Users'], ['orders', 'Orders'], ['withdrawals', 'Withdrawals'], ['refunds', 'Refunds']];

export default function Review() {
  const [state, setState] = useState('loading'); // loading, login, off, error, ready
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('overview');
  const [flt, setFlt] = useState('open');
  const [uq, setUq] = useState('');
  const [ufil, setUfil] = useState('all');
  const [openU, setOpenU] = useState(null);
  const [hist, setHist] = useState(null);
  const [spin, setSpin] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await call('GET', '/api/adtg');
      if (r.status === 401) setState('login');
      else if (r.off) setState('off');
      else if (!r.ok) setState('error');
      else {
        setData(r);
        setState('ready');
      }
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function refresh() {
    setSpin(true);
    await load();
    setSpin(false);
  }

  async function signOut() {
    try {
      await call('DELETE', '/api/adtg/login');
    } catch {}
    setData(null);
    setState('login');
  }

  if (state === 'loading') return <p className="empty" style={{ textAlign: 'center' }}>Loading…</p>;
  if (state === 'login') return <Login onDone={() => { setState('loading'); load(); }} />;
  if (state === 'off' || state === 'error') {
    return (
      <div id="auth">
        <div className="authbox">
          <div className="mark"><MarkIcon /></div>
          <h1>{state === 'off' ? 'Review is off' : 'Cannot load'}</h1>
          <p className="mute">{state === 'off' ? 'Ask the admin.' : 'Check your connection and try again.'}</p>
          {state === 'error' && <button className="btn" onClick={load}>Retry</button>}
        </div>
      </div>
    );
  }

  const { stats, users = [], orders = [], withdrawals = [], refunds = [], who } = data;
  const badge = { orders: orders.filter(orderOpen).length, withdrawals: withdrawals.filter(wdOpen).length, refunds: refunds.filter(rrOpen).length };
  const needle = uq.trim().toLowerCase();
  const found = needle ? users.filter((u) => `${u.id} ${u.tg ? `@${u.tg}` : ''}`.toLowerCase().includes(needle)) : users;
  const UFIL = { all: () => true, blocked: (u) => !!u.blocked, frozen: (u) => !!u.frozen, unver: (u) => u.kyc.status !== 'verified', wd: (u) => u.withdrawalsOpen > 0, flag: (u) => u.flags.length > 0 };
  const shownUsers = found.filter(UFIL[ufil] || UFIL.all).sort((a, b) => (b.joined || 0) - (a.joined || 0));
  const openFirst = (isOpen) => (a, b) => Number(isOpen(b)) - Number(isOpen(a));
  const shownOrders = flt === 'open' ? orders.filter(orderOpen) : [...orders].sort(openFirst(orderOpen));
  const shownWds = flt === 'open' ? withdrawals.filter(wdOpen) : [...withdrawals].sort(openFirst(wdOpen));
  const shownRrs = flt === 'open' ? refunds.filter(rrOpen) : [...refunds].sort(openFirst(rrOpen));

  return (
    <>
      <div className="top">
        <h2>Review</h2>
        <div className="adm-btns">
          <button className="swap" style={SM} disabled={spin} onClick={refresh}>Refresh</button>
          <button className="swap" style={SM} onClick={signOut}>Sign out</button>
        </div>
      </div>
      <p className="fine" style={{ margin: '0 0 8px' }}>{who} · view only</p>

      <div className="adm-nav" role="navigation" aria-label="Review sections">
        <div className="adm-tabs" role="group">
          {TABS.map(([k, l]) => (
            <button key={k} aria-pressed={tab === k} onClick={() => { setTab(k); setFlt('open'); window.scrollTo({ top: 0 }); }}>
              {l}
              {badge[k] > 0 && <b>{badge[k]}</b>}
            </button>
          ))}
        </div>
      </div>

      {tab === 'overview' && (
        <div className="adm-stack">
          <div className="stats">
            <Stat l="Users" v={stats.users} s={stats.truncated ? `first ${stats.loaded} shown` : undefined} />
            <Stat l="Miners" v={`${stats.online}/${stats.miners}`} s="online" />
            <Stat l="Hash power" v={fmtTh(stats.th)} s="TH/s" />
          </div>
          <div className="stats">
            <Stat l="Daily payouts" v={`$${stats.dailyUsd.toFixed(2)}`} />
            <Stat l="Withdrawn" v={stats.withdrawnBtc.toFixed(4)} s="BTC" />
            <Stat l="KYC pending" v={stats.kycPending} />
          </div>
          {stats.withdrawalsOpen > 0 && (
            <button className="card adm-alert" onClick={() => setTab('withdrawals')}>
              <b>{stats.withdrawalsOpen} withdrawal{stats.withdrawalsOpen === 1 ? '' : 's'} open</b>
              <span className="mute">Open ›</span>
            </button>
          )}
          {stats.ordersReview > 0 && (
            <button className="card adm-alert" onClick={() => setTab('orders')}>
              <b>{stats.ordersReview} order{stats.ordersReview === 1 ? '' : 's'} need a check</b>
              <span className="mute">Open ›</span>
            </button>
          )}
          {stats.refundsOpen > 0 && (
            <button className="card adm-alert" onClick={() => setTab('refunds')}>
              <b>{stats.refundsOpen} refund request{stats.refundsOpen === 1 ? '' : 's'} open</b>
              <span className="mute">Open ›</span>
            </button>
          )}
        </div>
      )}

      {tab === 'users' && (
        <div className="adm-stack">
          <div className="field" style={{ marginTop: 0 }}>
            <input id="rvq" type="search" autoComplete="off" autoCapitalize="none" spellCheck="false" placeholder=" " value={uq} onChange={(e) => setUq(e.target.value)} />
            <label htmlFor="rvq">Search users</label>
          </div>
          <div className="minitabs adm-filter" role="group" aria-label="Filter users">
            {[['all', 'All'], ['blocked', 'Blocked'], ['frozen', 'Paused'], ['unver', 'Unverified'], ['wd', 'Withdrawals'], ['flag', 'Flagged']].map(([k, t]) => (
              <button key={k} aria-pressed={ufil === k} onClick={() => setUfil(k)}>{t}</button>
            ))}
          </div>
          <span className="mute">{shownUsers.length} user{shownUsers.length === 1 ? '' : 's'}</span>
          {shownUsers.length === 0 && <p className="empty" style={{ textAlign: 'center' }}>No user matches.</p>}
          {shownUsers.map((u) => (
            <div className="card adm-fold" data-open={openU === u.id} key={u.id}>
              <button type="button" className="adm-fh" aria-expanded={openU === u.id} onClick={() => setOpenU(openU === u.id ? null : u.id)}>
                <span>
                  <span className="adm-ft">{u.tg ? `@${u.tg}` : u.id}</span>
                  <small>{u.available.toFixed(8)} BTC · {u.miners.length} miner{u.miners.length === 1 ? '' : 's'}{u.blocked ? ' · blocked' : ''}{u.frozen ? ' · withdrawals paused' : ''}{u.flags.length ? ' · flagged' : ''}</small>
                </span>
                {u.kyc.status !== 'none' && <Pill tone={u.kyc.status === 'verified' ? 'ok' : 'warn'}>{KYC[u.kyc.status] || u.kyc.status}</Pill>}
                <i aria-hidden="true" />
              </button>
              {openU === u.id && (
                <div className="adm-fb">
                  <div className="adm-tiles">
                    <div><small>Balance</small><b>{u.available.toFixed(8)}<span>BTC</span></b></div>
                    <div><small>Earned</small><b>{u.earned.toFixed(8)}<span>BTC</span></b></div>
                    <div><small>Deposited</small><b>{u.deposited.toFixed(8)}<span>BTC</span></b></div>
                    <div><small>Withdrawn</small><b>{u.withdrawn.toFixed(5)}<span>BTC</span></b></div>
                  </div>
                  <div className="adm-kv">
                    {u.tg && <div><small>ID</small><b>{u.id}</b></div>}
                    <div><small>Joined</small><b>{when(u.joined) || '-'}</b></div>
                    <div><small>Last sign-in</small><b>{when(u.lastIn) || '-'}</b></div>
                    <div><small>Invited by</small><b>{u.refBy || '-'}</b></div>
                    <div><small>Friends invited</small><b>{u.invited} · {u.reward.toFixed(8)} BTC</b></div>
                    <div><small>Boosts</small><b>{u.boostsRunning} running · {u.boostWins} won</b></div>
                    <div><small>Open orders · withdrawals</small><b>{u.ordersOpen} · {u.withdrawalsOpen}</b></div>
                    <div><small>Status</small><b style={u.blocked ? { color: 'var(--red)' } : undefined}>{u.blocked ? `Blocked ${when(u.blocked)}` : 'Active'}</b></div>
                    <div><small>Two-factor</small><b>{u.twofa ? 'On' : 'Off'}</b></div>
                    <div><small>Withdrawals</small><b style={u.frozen ? { color: 'var(--red)' } : undefined}>{u.frozen ? `Paused ${when(u.frozen)}` : 'Open'}</b></div>
                    {u.adjust !== 0 && <div><small>Changed by admin</small><b>{u.adjust > 0 ? '+' : ''}{u.adjust.toFixed(8)} BTC</b></div>}
                  </div>
                  {u.flags.length > 0 && <div className="row"><span className="mute">Flags</span><b style={{ color: 'var(--gold)', textAlign: 'right' }}>{u.flags.join(' · ')}</b></div>}

                  {u.kyc.status !== 'none' && (
                    <>
                      <span className="eyebrow adm-sub" style={u.kyc.status === 'pending' ? { color: 'var(--gold)' } : undefined}>{u.kyc.status === 'pending' ? `Verification submitted ${when(u.kyc.submittedAt)}` : 'Verification'}</span>
                      {u.kyc.name && <div className="row"><span className="mute">Name</span><b>{u.kyc.name}</b></div>}
                      {u.kyc.dob && <div className="row"><span className="mute">Born</span><b>{u.kyc.dob}</b></div>}
                      {u.kyc.country && <div className="row"><span className="mute">Country</span><b>{u.kyc.country}</b></div>}
                      {u.kyc.doc && <div className="row"><span className="mute">Document</span><b>{u.kyc.doc}</b></div>}
                    </>
                  )}

                  <div className="adm-grid two" style={{ marginTop: 12 }}>
                    <button className="swap" style={SM} onClick={() => setHist(hist === u.id ? null : u.id)}>{hist === u.id ? 'Hide history' : `Show history · ${u.history.length}`}</button>
                  </div>
                  {hist === u.id && u.history.length === 0 && <p className="empty" style={{ paddingTop: 8 }}>Nothing yet.</p>}
                  {hist === u.id && u.history.map((h, i) => (
                    <div className="row adm-m" key={`${h.at}-${i}`}>
                      <div>{h.label || h.kind}<small>{when(h.at) || h.date}{h.status ? ` · ${h.status}` : ''}</small></div>
                      <b>{h.amount ? `${h.amount} ${h.coin}` : ''}</b>
                    </div>
                  ))}

                  <div className="cardhead" style={{ marginTop: 16, marginBottom: 0 }}>
                    <h3 style={{ fontSize: 14 }}>Miners · {u.miners.length}</h3>
                  </div>
                  {u.miners.length === 0 && <p className="empty" style={{ paddingTop: 8 }}>No active miners.</p>}
                  {u.miners.map((m) => (
                    <div className="adm-miner" key={m.serial}>
                      <div className="adm-mh">
                        <span className="adm-mn">{m.name}</span>
                        <b>${m.dailyUsd.toFixed(2)}<span>/day</span></b>
                      </div>
                      <small><span className="serial">{m.serial}</span> · Day {m.elapsed}/{m.days}{m.online ? '' : ' · offline'}</small>
                      <div className="adm-bar"><i style={{ width: `${Math.min(100, Math.max(0, (m.elapsed / (m.days || 1)) * 100))}%` }} /></div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'orders' && (
        <div className="adm-stack">
          <Filter value={flt} onPick={setFlt} open={orders.filter(orderOpen).length} all={orders.length} />
          {shownOrders.length === 0 && <p className="empty" style={{ textAlign: 'center' }}>{orders.length === 0 ? 'No crypto orders yet.' : 'Nothing open.'}</p>}
          {shownOrders.map((o) => (
            <Fold key={o.id} title={`${o.label} · $${o.usd}`} sub={`${o.userId} · ${when(o.at)}`} start={orderOpen(o)} pill={<Pill tone={o.status === 'paid' ? 'ok' : o.status === 'review' ? 'warn' : o.status === 'failed' ? 'bad' : ''}>{ORDER[o.status] || o.status}</Pill>}>
              {(o.paidAt || o.serial || o.invoiceId) ? (
                <div className="adm-kv" style={{ borderTop: 0, marginTop: 4, paddingTop: 0 }}>
                  {o.paidAt && <div><small>Paid</small><b>{when(o.paidAt)}</b></div>}
                  {o.serial && <div><small>Miner</small><b className="serial">{o.serial}</b></div>}
                  {o.invoiceId && <div><small>Invoice</small><b className="serial">{o.invoiceId}</b></div>}
                </div>
              ) : (
                <p className="fine" style={{ margin: 0 }}>No more details.</p>
              )}
            </Fold>
          ))}
        </div>
      )}

      {tab === 'withdrawals' && (
        <div className="adm-stack">
          <Filter value={flt} onPick={setFlt} open={withdrawals.filter(wdOpen).length} all={withdrawals.length} />
          {shownWds.length === 0 && <p className="empty" style={{ textAlign: 'center' }}>{withdrawals.length === 0 ? 'No withdrawals yet.' : 'Nothing open.'}</p>}
          {shownWds.map((w) => (
            <Fold key={w.id} title={`${w.amount} ${String(w.asset).toUpperCase()}`} sub={`${w.userId} · ${when(w.at)}`} start={wdOpen(w)} pill={<Pill tone={w.status === 'sent' ? 'ok' : wdOpen(w) ? 'warn' : 'bad'}>{WD[w.status] || w.status}</Pill>}>
              <div className="adm-tiles">
                <div><small>Pay out</small><b>{w.receive}<span>{String(w.asset).toUpperCase()}</span></b></div>
                <div><small>Network</small><b>{String(w.net).toUpperCase()}</b></div>
              </div>
              <div className="adm-addr"><small>Address</small><span className="serial">{w.address}</span></div>
              {w.txid && <div className="adm-addr"><small>Transaction</small><span className="serial">{w.txid}</span></div>}
            </Fold>
          ))}
        </div>
      )}

      {tab === 'refunds' && (
        <div className="adm-stack">
          <Filter value={flt} onPick={setFlt} open={refunds.filter(rrOpen).length} all={refunds.length} />
          {shownRrs.length === 0 && <p className="empty" style={{ textAlign: 'center' }}>{refunds.length === 0 ? 'No refund requests yet.' : 'Nothing open.'}</p>}
          {shownRrs.map((r) => (
            <Fold key={r.id} title={`${r.serial} · ${RR_WHY[r.reason] || r.reason}`} sub={`${r.userId} · ${when(r.at)}`} start={rrOpen(r)} pill={<Pill tone={r.status === 'approved' ? 'ok' : r.status === 'pending' ? 'warn' : 'bad'}>{RR[r.status] || r.status}</Pill>}>
              <div className="adm-kv" style={{ borderTop: 0, marginTop: 4, paddingTop: 0 }}>
                <div><small>Reason</small><b>{RR_WHY[r.reason] || r.reason}</b></div>
                {r.again && <div><small>Buy again?</small><b>{RR_AGAIN[r.again] || r.again}</b></div>}
              </div>
              {r.note && <div className="adm-addr"><small>Their note</small><span>{r.note}</span></div>}
              {r.answer && <div className="adm-addr"><small>Our answer</small><span>{r.answer}</span></div>}
            </Fold>
          ))}
        </div>
      )}
    </>
  );
}
