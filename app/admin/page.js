'use client';
import { useCallback, useEffect, useState } from 'react';
import { fmtTh, fmtUsd } from '@/lib/data';
import { formatSerial } from '@/lib/contracts';
import { useToast } from '@/components/Toast';

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

const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
const when = (t) => (t ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const ORDER = { pending: 'Waiting', review: 'Needs a check', paid: 'Paid', cancelled: 'Closed', expired: 'Expired', failed: 'Failed' };
const WD = { pending: 'Needs approval', approved: 'Approved, pay it', sent: 'Sent', failed: 'Failed, refunded', rejected: 'Rejected, refunded' };
const KYC = { none: 'Not verified', pending: 'Pending review', verified: 'Verified' };
const CORE_HALLS = ['tx-1', 'is-2', 'no-1'];
const SM = { width: 'auto', margin: 0, padding: '0 12px', minHeight: 36 };
const REF_FIELDS = [
  ['firstPct', 'Referrer: first purchase (%)'],
  ['dailyPct', 'Referrer: friend daily payouts (%)'],
  ['dailyDays', 'Referrer: daily reward days'],
  ['capPct', 'Cap (% of friend spend)'],
  ['refereeTh', 'Friend gift (TH/s, 0 = off)'],
  ['refereeDays', 'Friend gift term (days)'],
  ['refereeMinUsd', 'Min first purchase (USD)'],
  ['monthlyLimit', 'Rewarded friends per month'],
  ['maxRebate', 'Largest rebate a code can give (%)'],
  ['maxCodes', 'Codes per user (with the default)'],
];

// Smart Mining: sell on/off, the payout multiplier for new purchases, and which coins may be picked. See lib/server/smart-admin.js.
function SmartCard({ smart, busy, run }) {
  const set = smart?.settings || { enabled: true, payout: 1.06 };
  const coins = smart?.coins || [];
  const [payout, setPayout] = useState(String(set.payout));
  useEffect(() => setPayout(String(set.payout)), [set.payout]);
  return (
    <div className="card">
      <h3>Smart Mining</h3>
      <div className="row"><span className="mute">Selling</span><b>{set.enabled ? 'On' : 'Off'}</b></div>
      <Field id="smp" label="Payout at the reference market (times the budget)" inputMode="decimal" value={payout} onChange={setPayout} />
      <div className="adm-actions">
        <button className="btn" disabled={busy} onClick={() => run({ action: 'smart-settings', enabled: set.enabled, payout }, 'Smart Mining payout saved')}>Save payout</button>
        <button className="btn" disabled={busy} onClick={() => run({ action: 'smart-settings', enabled: !set.enabled, payout: set.payout }, set.enabled ? 'Smart Mining is off' : 'Smart Mining is on')}>
          {set.enabled ? 'Turn off' : 'Turn on'}
        </button>
      </div>
      <p className="fine" style={{ margin: '8px 0 12px' }}>Off hides Smart Mining and refuses new purchases; miners already running keep paying. A new payout applies to purchases made after saving, each miner keeps the one it was bought with.</p>
      {coins.map((c) => (
        <div className="row adm-m" key={c.symbol}>
          <div>
            {c.symbol} · {c.name}
            <small>{c.algo} · {c.days} day{c.days === 1 ? '' : 's'} of data{c.ref === null ? ' · no reference yet' : ''}{c.enabled ? '' : ' · off'}</small>
          </div>
          <button className="btn ghost" disabled={busy} onClick={() => run({ action: 'smart-coin', symbol: c.symbol, enabled: !c.enabled }, c.enabled ? `${c.symbol} turned off` : `${c.symbol} turned on`)}>
            {c.enabled ? 'Turn off' : 'Turn on'}
          </button>
        </div>
      ))}
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

function Field({ id, label, value, onChange, ...rest }) {
  return (
    <div className="field" style={{ marginTop: 12 }}>
      <input id={id} placeholder=" " value={value} onChange={(e) => onChange(e.target.value)} {...rest} />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}

function Pick({ id, label, value, onChange, children }) {
  return (
    <div className="field" style={{ marginTop: 12 }}>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>{children}</select>
      <label htmlFor={id}>{label}</label>
    </div>
  );
}

function PlanForm({ draft, set, halls, isNew, busy, onSave, onCancel, onDelete }) {
  const net = halls[draft.hall]?.net ?? 0;
  const daily = Number(String(draft.th).replace(',', '.')) * net;
  return (
    <div className="adm-form">
      <Field id="pn" label="Name" value={draft.name} onChange={(v) => set('name', v)} maxLength={24} />
      <Field id="pt" label="Hash power (TH/s)" inputMode="decimal" value={draft.th} onChange={(v) => set('th', v)} />
      <Field id="pp" label="Price (USD)" inputMode="decimal" value={draft.price} onChange={(v) => set('price', v)} />
      <Field id="pd" label="Term (days)" inputMode="numeric" value={draft.days} onChange={(v) => set('days', v)} />
      <Pick id="ph" label="Hall" value={draft.hall} onChange={(v) => set('hall', v)}>
        {Object.entries(halls).map(([id, h]) => <option key={id} value={id}>{h.name}</option>)}
      </Pick>
      <Field id="pb" label="Description" value={draft.blurb} onChange={(v) => set('blurb', v)} maxLength={140} />
      <Pick id="pf" label="Most chosen tag" value={draft.featured} onChange={(v) => set('featured', v)}>
        <option value="no">No</option>
        <option value="yes">Yes</option>
      </Pick>
      <p className="fine" style={{ margin: '12px 0 0' }}>
        Daily payout ~${Number.isFinite(daily) ? daily.toFixed(2) : '0.00'}, worked out from the hall&apos;s net rate. Miners already bought keep their terms.
      </p>
      <div className="adm-actions">
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
        <button className="btn" disabled={busy} onClick={onSave}>Save</button>
      </div>
      {!isNew && <button className="swap danger" disabled={busy} onClick={onDelete}>Delete plan</button>}
    </div>
  );
}

function HallForm({ draft, set, busy, isNew, canDelete, onSave, onCancel, onDelete }) {
  return (
    <div className="adm-form">
      <Field id="hn" label="Name" value={draft.name} onChange={(v) => set('name', v)} maxLength={40} />
      <Field id="hp" label="Location" value={draft.place} onChange={(v) => set('place', v)} maxLength={40} />
      <Field id="hw" label="Power source" value={draft.power} onChange={(v) => set('power', v)} maxLength={60} />
      <Field id="he" label="Efficiency (e.g. 17.5 J/TH)" value={draft.efficiency} onChange={(v) => set('efficiency', v)} maxLength={20} />
      <Field id="hr" label="Rig model" value={draft.rig} onChange={(v) => set('rig', v)} maxLength={40} />
      <Field id="hx" label="Net rate (USD per TH/s per day)" inputMode="decimal" value={draft.net} onChange={(v) => set('net', v)} />
      <p className="fine" style={{ margin: '12px 0 0' }}>
        {isNew ? 'A new hall can be picked for plans once saved.' : 'Changing the rate updates the daily payout of every miner in this hall and of the plans that use it.'}
      </p>
      <div className="adm-actions">
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
        <button className="btn" disabled={busy} onClick={onSave}>Save</button>
      </div>
      {canDelete && <button className="swap danger" disabled={busy} onClick={onDelete}>Delete hall</button>}
    </div>
  );
}

function Login({ onDone, setup }) {
  const [token, setToken] = useState('');
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (busy || !user || !pass || (setup && !token)) return;
    setBusy(true);
    setErr('');
    try {
      const r = await call('POST', '/api/admin/login', { token, user, pass });
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
        <div className="mark">O</div>
        <h1>Admin</h1>
        <p className="mute">{setup ? 'First time here. Enter the setup token, then choose the username and password you will use from now on.' : 'Sign in to continue.'}</p>
        {setup && (
          <div className="field">
            <input id="tk" type="password" autoComplete="off" placeholder=" " className={err ? 'bad' : ''} value={token} onChange={(e) => setToken(e.target.value)} />
            <label htmlFor="tk">Setup token</label>
          </div>
        )}
        <div className="field" style={{ marginTop: setup ? 12 : 0 }}>
          <input id="un" autoComplete="username" autoCapitalize="none" spellCheck="false" placeholder=" " className={err ? 'bad' : ''} value={user} onChange={(e) => setUser(e.target.value)} />
          <label htmlFor="un">Username</label>
        </div>
        <div className="field" style={{ marginTop: 12 }}>
          <input id="pw2" type="password" autoComplete={setup ? 'new-password' : 'current-password'} placeholder=" " className={err ? 'bad' : ''} value={pass} onChange={(e) => setPass(e.target.value)} />
          <label htmlFor="pw2">{setup ? 'Password (10+ characters)' : 'Password'}</label>
        </div>
        {err && <div className="ferr" role="alert">{err}</div>}
        <button className="btn" style={{ marginTop: 16 }} disabled={busy || !user || !pass || (setup && !token)}>{setup ? 'Create admin account' : 'Sign in'}</button>
      </form>
    </div>
  );
}

const ADJ0 = { id: null, op: 'add', cur: 'btc', amount: '', note: '' };

// The BTC a balance change comes to: typed in BTC, or typed in USD and converted at the current rate.
// The server converts again when the change is applied, so this is a preview.
const adjBtc = (a, rate) => {
  const n = Number(a.amount.trim().replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return a.cur === 'usd' ? (rate > 0 ? n / rate : 0) : n;
};

export default function Admin() {
  const [state, setState] = useState('loading'); // loading, login, off, error, ready
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('overview');
  const [busy, setBusy] = useState(false);
  const [to, setTo] = useState('all');
  const [title, setTitle] = useState('');
  const [msg, setMsg] = useState('');
  const [edit, setEdit] = useState(null); // { kind: 'plan' | 'hall', id, draft }
  const [setup, setSetup] = useState(false); // first run: no admin account yet
  const [refDraft, setRefDraft] = useState(null); // referral settings being edited, as strings
  const [tf, setTf] = useState({ code: '', planId: '' }); // test friend form
  const [pw, setPw] = useState({ cur: '', next: '' }); // admin password form
  const [adj, setAdj] = useState(ADJ0); // balance change form (one user at a time)
  const [toast, show] = useToast();

  const load = useCallback(async () => {
    try {
      const r = await call('GET', '/api/admin');
      if (r.status === 200) {
        setData(r);
        setState('ready');
      } else if (r.status === 401) {
        setSetup(!!r.setup);
        setState('login');
      }
      else if (r.status === 503) setState('off');
      else setState('error');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Runs one admin action, tells the result, then refreshes. Returns true when it worked.
  // `okText` is a string, or a function of the server's answer.
  async function run(body, okText) {
    if (busy) return false;
    setBusy(true);
    let ok = false;
    try {
      const r = await call('POST', '/api/admin', body);
      if (r.status === 401) {
        setState('login');
        return false;
      }
      ok = !!r.ok;
      show(ok ? (typeof okText === 'function' ? okText(r) : okText) : r.error || 'Failed.');
    } catch {
      show('No connection. Try again.');
    } finally {
      setBusy(false);
      load();
    }
    return ok;
  }

  async function signOut() {
    try {
      await call('DELETE', '/api/admin/login');
    } catch {}
    setData(null);
    setState('login');
  }

  if (state === 'loading') return <p className="empty" style={{ textAlign: 'center' }}>Loading…</p>;
  if (state === 'login') return <Login setup={setup} onDone={() => { setState('loading'); load(); }} />;
  if (state === 'off' || state === 'error') {
    return (
      <div id="auth">
        <div className="authbox">
          <div className="mark">O</div>
          <h1>{state === 'off' ? 'Admin is off' : 'Cannot load'}</h1>
          <p className="mute">
            {state === 'off'
              ? 'Set ADMIN_TOKEN (12 or more characters) in the environment and redeploy.'
              : 'Check your connection and try again.'}
          </p>
          {state === 'error' && <button className="btn" onClick={load}>Retry</button>}
        </div>
      </div>
    );
  }

  const { stats, users, orders = [], withdrawals = [], log = [], mode, btcUsd, rate, serial, catalog: cat, charts = { mock: true, feed: {} } } = data;
  const sendDisabled = busy || !title.trim();
  const setDraft = (k, v) => setEdit((e) => ({ ...e, draft: { ...e.draft, [k]: v } }));

  const planDraft = (p) => ({
    name: p?.name ?? '',
    th: p ? String(p.th) : '',
    price: p ? String(p.price) : '',
    days: p ? String(p.days) : '180',
    hall: p?.hall ?? Object.keys(cat.halls)[0],
    blurb: p?.blurb ?? '',
    featured: p?.featured ? 'yes' : 'no',
  });
  const hallDraft = (h) => !h ? { name: '', place: '', power: '', efficiency: '', rig: '', net: '' } : ({ name: h.name, place: h.place, power: h.power, efficiency: h.efficiency, rig: h.rig, net: String(h.net) });

  async function savePlan() {
    const d = edit.draft;
    const plan = { id: edit.id === 'new' ? undefined : edit.id, name: d.name, th: d.th, price: d.price, days: d.days, hall: d.hall, blurb: d.blurb, featured: d.featured === 'yes' };
    if (await run({ action: 'plan-save', plan }, 'Plan saved')) setEdit(null);
  }

  async function saveHall() {
    const ok = await run(
      { action: 'hall-save', id: edit.id === 'new' ? undefined : edit.id, hall: edit.draft },
      (r) => (r.updated ? `Hall saved · ${r.updated} miner${r.updated === 1 ? '' : 's'} updated` : 'Hall saved')
    );
    if (ok) setEdit(null);
  }

  const planForm = (isNew) => (
    <PlanForm
      draft={edit.draft}
      set={setDraft}
      halls={cat.halls}
      isNew={isNew}
      busy={busy}
      onSave={savePlan}
      onCancel={() => setEdit(null)}
      onDelete={async () => {
        if (window.confirm(`Delete the ${edit.draft.name} plan? Miners already bought are not affected.`) && (await run({ action: 'plan-delete', id: edit.id }, 'Plan deleted'))) setEdit(null);
      }}
    />
  );

  return (
    <>
      <div className="top">
        <h2>Admin</h2>
        <button className="swap" style={SM} onClick={signOut}>Sign out</button>
      </div>

      <div className="tabs" role="group" aria-label="Admin sections">
        {[['overview', 'Overview'], ['users', 'Users'], ['orders', 'Orders'], ['withdrawals', 'Withdrawals'], ['plans', 'Plans'], ['referrals', 'Referrals'], ['send', 'Send']].map(([k, l]) => (
          <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)}>{k === 'orders' && stats.ordersReview > 0 ? `${l} · ${stats.ordersReview}` : k === 'withdrawals' && stats.withdrawalsOpen > 0 ? `${l} · ${stats.withdrawalsOpen}` : l}</button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="adm-stack">
          <div className="stats">
            <Stat l="Users" v={stats.users} />
            <Stat l="Miners" v={`${stats.online}/${stats.miners}`} s="online" />
            <Stat l="Hash power" v={fmtTh(stats.th)} s="TH/s" />
          </div>
          <div className="stats">
            <Stat l="Daily payouts" v={`$${stats.dailyUsd.toFixed(2)}`} />
            <Stat l="Withdrawn" v={stats.withdrawnBtc.toFixed(4)} s="BTC" />
            <Stat l="KYC pending" v={stats.kycPending} />
          </div>
          {stats.withdrawalsOpen > 0 && (
            <button className="card adm-click" onClick={() => setTab('withdrawals')}>
              <b style={{ color: 'var(--gold)' }}>{stats.withdrawalsOpen} withdrawal{stats.withdrawalsOpen === 1 ? '' : 's'} to handle</b>
            </button>
          )}
          {stats.ordersReview > 0 && (
            <button className="card adm-click" onClick={() => setTab('orders')}>
              <b style={{ color: 'var(--gold)' }}>{stats.ordersReview} order{stats.ordersReview === 1 ? '' : 's'} need a check</b>
            </button>
          )}
          <div className="card">
            <h3>System</h3>
            <div className="row"><span className="mute">Storage</span><b>{mode}</b></div>
            <div className="row"><span className="mute">BTC fallback price</span><b>${btcUsd.toLocaleString()}</b></div>
            <div className="row"><span className="mute">Latest miner ID</span><b className="serial">{formatSerial(serial)}</b></div>
          </div>
          <div className="card">
            <h3>Hashrate and uptime charts</h3>
            <div className="row"><span className="mute">Showing</span><b>{charts.mock ? 'Mock data' : 'Real data'}</b></div>
            <div className="row">
              <span className="mute">Hall feed</span>
              <b>{!charts.feed.enabled ? 'Off (no TELEMETRY_KEY)' : charts.feed.samples ? `${charts.feed.miners} miner${charts.feed.miners === 1 ? '' : 's'} · last ${when(charts.feed.last)}` : 'Nothing received yet'}</b>
            </div>
            <div className="adm-actions">
              <button
                className="btn"
                disabled={busy}
                onClick={() => {
                  const toReal = charts.mock;
                  if (toReal && !charts.feed.samples && !window.confirm('No samples have come in from the halls yet, so the charts will say "No data yet". Switch anyway?')) return;
                  run({ action: 'charts-mock', mode: toReal ? 'real' : 'mock' }, toReal ? 'Charts now show real data' : 'Charts now show mock data');
                }}
              >
                {charts.mock ? 'Switch to real data' : 'Switch to mock data'}
              </button>
            </div>
            <p className="fine" style={{ margin: '8px 0 0' }}>Mock is made-up numbers. Real is what the halls report to /api/telemetry; with none, the charts say no data. Applies to every user at once.</p>
          </div>
          <SmartCard smart={data.smart} busy={busy} run={run} />
          <div className="card">
            <h3>Demo account</h3>
            <p className="fine" style={{ margin: '0 0 8px' }}>Wipes the demo account back to a clean slate: miners, activity, balance changes, withdrawals, payment orders and the invite test friends made under it. Real accounts are not touched.</p>
            <div className="adm-actions">
              <button
                className="btn"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm('Wipe the demo account? Its miners, activity, balance and test friends are deleted. This cannot be undone.')) return;
                  run({ action: 'demo-reset' }, (r) => `Demo account cleaned · ${r.miners} miner${r.miners === 1 ? '' : 's'} removed`);
                }}
              >
                Clean up demo account
              </button>
            </div>
          </div>
          <div className="card">
            <h3>Admin password</h3>
            <Field id="pwc" label="Current password" type="password" autoComplete="current-password" value={pw.cur} onChange={(v) => setPw((p) => ({ ...p, cur: v }))} />
            <Field id="pwn" label="New password (10+ characters)" type="password" autoComplete="new-password" value={pw.next} onChange={(v) => setPw((p) => ({ ...p, next: v }))} />
            <div className="adm-actions">
              <button className="btn" disabled={busy || !pw.cur || pw.next.length < 10} onClick={async () => (await run({ action: 'admin-password', current: pw.cur, next: pw.next }, 'Password changed')) && setPw({ cur: '', next: '' })}>Change password</button>
            </div>
            <p className="fine" style={{ margin: '8px 0 0' }}>Other signed-in browsers are signed out.</p>
          </div>
          <div className="card">
            <h3>Recent changes</h3>
            {log.length === 0 && <p className="empty" style={{ paddingTop: 8 }}>Nothing yet.</p>}
            {log.map((l, i) => (
              <div className="row adm-m" key={`${l.at}-${i}`}>
                <div>{l.action}<small>{l.detail}</small></div>
                <span className="mute">{when(l.at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'users' && (
        <div className="adm-stack">
          {users.map((u) => (
            <div className="card" key={u.id}>
              <div className="cardhead">
                <h3>{u.id}</h3>
                <span className={u.kyc.status === 'verified' ? 'up' : 'mute'}>{KYC[u.kyc.status] || u.kyc.status}</span>
              </div>
              <div className="row"><span className="mute">Available balance</span><b>{u.available.toFixed(8)} BTC</b></div>
              <div className="row"><span className="mute">Withdrawn</span><b>{u.withdrawn.toFixed(5)} BTC</b></div>
              <div className="row"><span className="mute">Balance changes by admin</span><b>{u.adjust > 0 ? '+' : ''}{u.adjust.toFixed(8)} BTC</b></div>
              {adj.id === u.id ? (
                <div className="adm-form">
                  <Pick id="ajo" label="Change" value={adj.op} onChange={(v) => setAdj({ ...adj, op: v })}>
                    <option value="add">Add to balance</option>
                    <option value="subtract">Take from balance</option>
                  </Pick>
                  <Pick id="ajc" label="Amount in" value={adj.cur} onChange={(v) => setAdj({ ...adj, cur: v, amount: '' })}>
                    <option value="btc">BTC</option>
                    <option value="usd">USD</option>
                  </Pick>
                  <Field id="aja" label={`Amount (${adj.cur === 'usd' ? 'USD' : 'BTC'})`} inputMode="decimal" value={adj.amount} onChange={(v) => setAdj({ ...adj, amount: v })} />
                  <Field id="ajn" label="Note for the record" value={adj.note} maxLength={80} onChange={(v) => setAdj({ ...adj, note: v })} />
                  <p className="fine" style={{ margin: '12px 0 0' }}>The user sees the change in their activity. To undo it, make the opposite change. Up to 10 BTC at a time.</p>
                  {adj.cur === 'usd' && adjBtc(adj, rate?.btc) > 0 && (
                    <p className="fine" style={{ margin: '6px 0 0' }}>About {adjBtc(adj, rate.btc).toFixed(8)} BTC at ${rate.btc.toLocaleString()} per BTC{rate.source === 'live' ? '' : ' (fallback price)'}. The rate is taken again when you apply.</p>
                  )}
                  {adj.op === 'subtract' && adjBtc(adj, rate?.btc) > u.available && (
                    <p className="fine" style={{ margin: '6px 0 0', color: 'var(--red)' }}>That is more than the {u.available.toFixed(8)} BTC available, so it will be refused.</p>
                  )}
                  <div className="adm-actions">
                    <button className="btn ghost" onClick={() => setAdj(ADJ0)}>Cancel</button>
                    <button
                      className="btn"
                      disabled={busy || !adj.amount.trim() || !adj.note.trim() || (adj.op === 'subtract' && adjBtc(adj, rate?.btc) > u.available)}
                      onClick={async () => {
                        if (!window.confirm(`${adj.op === 'add' ? 'Add' : 'Take'} ${adj.amount.trim()} ${adj.cur === 'usd' ? `USD (about ${adjBtc(adj, rate?.btc).toFixed(8)} BTC)` : 'BTC'} ${adj.op === 'add' ? 'to' : 'from'} ${u.id}?`)) return;
                        const amountField = adj.cur === 'usd' ? { amountUsd: adj.amount } : { amountBtc: adj.amount };
                        if (await run({ action: 'balance', userId: u.id, op: adj.op, ...amountField, note: adj.note }, (r) => `Balance updated · ${adj.op === 'add' ? '+' : '-'}${r.btc.toFixed(8)} BTC`)) setAdj(ADJ0);
                      }}
                    >
                      Apply
                    </button>
                  </div>
                </div>
              ) : (
                <div className="adm-actions">
                  <button className="swap" style={SM} disabled={busy} onClick={() => setAdj({ ...ADJ0, id: u.id })}>Change balance</button>
                </div>
              )}

              {u.kyc.status === 'pending' && (
                <>
                  <span className="eyebrow adm-sub" style={{ color: 'var(--gold)' }}>Verification submitted {when(u.kyc.submittedAt)}</span>
                  <div className="row"><span className="mute">Name</span><b>{u.kyc.name}</b></div>
                  <div className="row"><span className="mute">Born</span><b>{u.kyc.dob}</b></div>
                  <div className="row"><span className="mute">Country</span><b>{u.kyc.country}</b></div>
                  <div className="row"><span className="mute">Document</span><b>{u.kyc.doc}</b></div>
                  {u.kyc.photos && (
                    <div className="row">
                      <span className="mute">Photos</span>
                      <b>{mb(u.kyc.photos.front.size)} + {mb(u.kyc.photos.selfie.size)}</b>
                    </div>
                  )}
                  <p className="fine" style={{ margin: '4px 0 0' }}>Photos are not stored yet, so this review uses the details only.</p>
                  <div className="adm-actions">
                    <button className="btn ghost danger" disabled={busy} onClick={() => window.confirm(`Reject verification for ${u.id}?`) && run({ action: 'kyc', userId: u.id, decision: 'reject' }, 'Rejected')}>Reject</button>
                    <button className="btn" disabled={busy} onClick={() => run({ action: 'kyc', userId: u.id, decision: 'approve' }, 'Approved')}>Approve</button>
                  </div>
                </>
              )}

              <div className="cardhead" style={{ marginTop: 16, marginBottom: 0 }}>
                <h3 style={{ fontSize: 14 }}>Miners · {u.miners.length}</h3>
                {u.miners.length > 0 && (
                  <button
                    className="swap danger"
                    style={SM}
                    disabled={busy}
                    onClick={() => window.confirm(`Remove all ${u.miners.length} miner${u.miners.length === 1 ? '' : 's'} from ${u.id}? This cannot be undone.`) && run({ action: 'miners-clear', userId: u.id }, (r) => `${r.removed} removed`)}
                  >
                    Remove all
                  </button>
                )}
              </div>
              {u.miners.length === 0 && <p className="empty" style={{ paddingTop: 8 }}>No active miners.</p>}
              {u.miners.map((m) => (
                <div className="row adm-m" key={m.serial}>
                  <div>
                    {m.name}
                    <small>
                      <span className="serial">{m.serial}</span> · ${m.dailyUsd.toFixed(2)}/day · Day {m.elapsed}/{m.days}
                      {m.online ? '' : ' · offline'}
                    </small>
                  </div>
                  <div className="adm-btns">
                    <button className="btn ghost" disabled={busy} onClick={() => run({ action: 'miner', userId: u.id, serial: m.serial, op: m.online ? 'offline' : 'online' }, m.online ? 'Set offline' : 'Set online')}>
                      {m.online ? 'Offline' : 'Online'}
                    </button>
                    <button className="btn ghost" disabled={busy} onClick={() => window.confirm(`Refund ${m.serial}? The miner is removed and its price goes back to the balance. Only allowed within 24 hours, before the first payout day.`) && run({ action: 'miner', userId: u.id, serial: m.serial, op: 'refund' }, (r) => `Refunded ${r.btc.toFixed(8)} BTC ($${r.usd.toFixed(2)})`)}>
                      Refund
                    </button>
                    <button className="btn ghost danger" disabled={busy} onClick={() => window.confirm(`Remove ${m.serial}? This cannot be undone.`) && run({ action: 'miner', userId: u.id, serial: m.serial, op: 'delete' }, 'Miner removed')}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {tab === 'orders' && (
        <div className="adm-stack">
          {orders.length === 0 && <p className="empty" style={{ textAlign: 'center' }}>No crypto orders yet.</p>}
          {orders.map((o) => (
            <div className="card" key={o.id}>
              <div className="cardhead">
                <h3>{o.label} · ${o.usd}</h3>
                <span className={o.status === 'paid' ? 'up' : o.status === 'review' ? '' : 'mute'} style={o.status === 'review' ? { color: 'var(--gold)' } : undefined}>{ORDER[o.status] || o.status}</span>
              </div>
              <div className="row"><span className="mute">User</span><b>{o.userId}</b></div>
              <div className="row"><span className="mute">Created</span><b>{when(o.at)}</b></div>
              {o.paidAt && <div className="row"><span className="mute">Paid</span><b>{when(o.paidAt)}</b></div>}
              {o.serial && <div className="row"><span className="mute">Miner</span><b className="serial">{o.serial}</b></div>}
              {o.invoiceId && <div className="row"><span className="mute">Invoice</span><b className="serial">{o.invoiceId}</b></div>}
              {(o.status === 'review' || o.status === 'pending') && (
                <div className="adm-actions">
                  <button className="btn ghost danger" disabled={busy} onClick={() => window.confirm(`Close this order for ${o.userId}?`) && run({ action: 'order', userId: o.userId, orderId: o.id, decision: 'reject' }, 'Order closed')}>Close</button>
                  <button className="btn" disabled={busy} onClick={() => window.confirm(`Start the miner for ${o.userId}? Only do this once you have checked the payment with the payment provider (or on the blockchain).`) && run({ action: 'order', userId: o.userId, orderId: o.id, decision: 'approve' }, (r) => `Miner ${r.serial} started`)}>Start miner</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'withdrawals' && (
        <div className="adm-stack">
          {withdrawals.length === 0 && <p className="empty" style={{ textAlign: 'center' }}>No withdrawals yet.</p>}
          {withdrawals.map((w) => {
            const act = (decision, okText, txid) => run({ action: 'withdrawal', userId: w.userId, withdrawalId: w.id, decision, txid }, okText);
            const open = w.status === 'pending' || w.status === 'approved';
            return (
              <div className="card" key={w.id}>
                <div className="cardhead">
                  <h3>{w.amount} {String(w.asset).toUpperCase()}</h3>
                  <span className={w.status === 'sent' ? 'up' : open ? '' : 'mute'} style={open ? { color: 'var(--gold)' } : undefined}>{WD[w.status] || w.status}</span>
                </div>
                <div className="row"><span className="mute">User</span><b>{w.userId}</b></div>
                <div className="row"><span className="mute">Network</span><b>{String(w.net).toUpperCase()}</b></div>
                <div className="row"><span className="mute">Pay out</span><b>{w.receive} {String(w.asset).toUpperCase()}</b></div>
                <div className="row"><span className="mute">Address</span><b className="serial" style={{ wordBreak: 'break-all', userSelect: 'all', textAlign: 'right' }}>{w.address}</b></div>
                <div className="row"><span className="mute">Asked</span><b>{when(w.at)}</b></div>
                {w.txid && <div className="row"><span className="mute">Transaction</span><b className="serial" style={{ wordBreak: 'break-all', textAlign: 'right' }}>{w.txid}</b></div>}
                {w.status === 'pending' && (
                  <div className="adm-actions">
                    <button className="btn ghost danger" disabled={busy} onClick={() => window.confirm(`Reject this withdrawal for ${w.userId}? The amount goes back to their balance.`) && act('reject', 'Rejected and refunded')}>Reject</button>
                    <button className="btn" disabled={busy} onClick={() => window.confirm(`Approve ${w.amount} ${String(w.asset).toUpperCase()} to ${w.address}?`) && act('approve', 'Approved')}>Approve</button>
                  </div>
                )}
                {w.status === 'approved' && (
                  <div className="adm-actions">
                    <button className="btn ghost danger" disabled={busy} onClick={() => window.confirm(`Mark as failed? The amount goes back to ${w.userId}'s balance.`) && act('fail', 'Marked failed and refunded')}>Failed</button>
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={() => {
                        const txid = window.prompt('Paste the transaction id of the payout you made:');
                        if (txid && txid.trim()) act('sent', 'Marked as sent', txid.trim());
                      }}
                    >
                      Mark sent
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === 'plans' && (
        <div className="adm-stack">
          <div className="card">
            <div className="cardhead">
              <h3>Plans</h3>
              <button className="swap" style={SM} disabled={busy} onClick={() => setEdit({ kind: 'plan', id: 'new', draft: planDraft(null) })}>Add plan</button>
            </div>
            {edit?.kind === 'plan' && edit.id === 'new' && planForm(true)}
            {cat.plans.map((p, i) =>
              edit?.kind === 'plan' && edit.id === p.id ? (
                <div key={p.id} className="adm-edit">{planForm(false)}</div>
              ) : (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center' }}>
                  <button type="button" className="row adm-click" style={{ flex: 1, minWidth: 0 }} aria-label={`Edit ${p.name}`} onClick={() => setEdit({ kind: 'plan', id: p.id, draft: planDraft(p) })}>
                    <div>
                      {p.name}{p.featured ? ' ★' : ''}
                      <small>{fmtTh(p.th)} TH/s · {p.days} days · {cat.halls[p.hall]?.name}</small>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <b>${fmtUsd(p.price)}</b>
                      <small>~{p.daily}/day</small>
                    </div>
                  </button>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 8px' }}>
                    <button className="swap" style={{ ...SM, minHeight: 32, padding: '0 10px' }} aria-label={`Move ${p.name} up`} disabled={busy || i === 0} onClick={() => run({ action: 'plan-move', id: p.id, dir: 'up' }, 'Moved')}>▲</button>
                    <button className="swap" style={{ ...SM, minHeight: 32, padding: '0 10px' }} aria-label={`Move ${p.name} down`} disabled={busy || i === cat.plans.length - 1} onClick={() => run({ action: 'plan-move', id: p.id, dir: 'down' }, 'Moved')}>▼</button>
                  </div>
                </div>
              )
            )}
          </div>

          <div className="card">
            <div className="cardhead">
              <h3>Halls</h3>
              <button className="swap" style={SM} disabled={busy} onClick={() => setEdit({ kind: 'hall', id: 'new', draft: hallDraft(null) })}>Add hall</button>
            </div>
            {edit?.kind === 'hall' && edit.id === 'new' && (
              <div className="adm-edit">
                <HallForm draft={edit.draft} set={setDraft} busy={busy} isNew onSave={saveHall} onCancel={() => setEdit(null)} />
              </div>
            )}
            {Object.entries(cat.halls).map(([id, h]) =>
              edit?.kind === 'hall' && edit.id === id ? (
                <div key={id} className="adm-edit">
                  <HallForm
                    draft={edit.draft}
                    set={setDraft}
                    busy={busy}
                    canDelete={!CORE_HALLS.includes(id)}
                    onSave={saveHall}
                    onCancel={() => setEdit(null)}
                    onDelete={async () => {
                      if (window.confirm(`Delete ${h.name}? This only works when no plan or miner uses it.`) && (await run({ action: 'hall-delete', id }, 'Hall deleted'))) setEdit(null);
                    }}
                  />
                </div>
              ) : (
                <button key={id} type="button" className="row adm-click" aria-label={`Edit ${h.name}`} onClick={() => setEdit({ kind: 'hall', id, draft: hallDraft(h) })}>
                  <div>
                    {h.name}
                    <small>{h.rig} · {h.efficiency} · {h.place}</small>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <b>${h.net}</b>
                    <small>per TH/day</small>
                  </div>
                </button>
              )
            )}
          </div>

          <button
            className="btn ghost danger"
            disabled={busy}
            onClick={async () => {
              if (window.confirm('Reset all plans and halls to the built-in defaults? Hall rates of existing miners follow the defaults again.') && (await run({ action: 'catalog-reset' }, 'Reset to defaults'))) setEdit(null);
            }}
          >
            Reset to defaults
          </button>
        </div>
      )}

      {tab === 'referrals' && (() => {
        const R = data.referrals;
        const d = refDraft || Object.fromEntries(Object.entries(R.settings).map(([k, v]) => [k, String(v)]));
        const put = (k, v) => setRefDraft({ ...d, [k]: v });
        const code = tf.code || R.codes[0]?.code || '';
        const planId = tf.planId || cat.plans[0]?.id || '';
        return (
          <div className="adm-stack">
            <div className="card">
              <h3>Rewards</h3>
              {REF_FIELDS.map(([k, l]) => (
                <Field key={k} id={`rf-${k}`} label={l} inputMode="decimal" value={d[k]} onChange={(v) => put(k, v)} />
              ))}
              <p className="fine" style={{ margin: '12px 0 0' }}>
                The referrer&apos;s total is capped at the cap share of what the friend spends, minus the cost of the friend&apos;s gift miner. Changes apply to rewards from now on.
              </p>
              <div className="adm-actions">
                <button className="btn ghost" disabled={busy} onClick={async () => { if (await run({ action: 'ref-reset' }, 'Reset to defaults')) setRefDraft(null); }}>Defaults</button>
                <button className="btn" disabled={busy} onClick={async () => { if (await run({ action: 'ref-settings', settings: d }, 'Saved')) setRefDraft(null); }}>Save</button>
              </div>
            </div>

            <div className="card">
              <h3>Try it</h3>
              <p className="fine" style={{ margin: '0 0 4px' }}>Creates a test friend who signs up with the code and buys the plan.</p>
              <Pick id="tfc" label="Inviter code" value={code} onChange={(v) => setTf({ ...tf, code: v })}>
                {R.codes.map((c) => <option key={c.code} value={c.code}>{c.id} · {c.code}</option>)}
              </Pick>
              <Pick id="tfp" label="Plan bought" value={planId} onChange={(v) => setTf({ ...tf, planId: v })}>
                {cat.plans.map((p) => <option key={p.id} value={p.id}>{p.name} · ${fmtUsd(p.price)}</option>)}
              </Pick>
              <div style={{ height: 12 }} />
              <button className="btn" disabled={busy || !code} onClick={() => run({ action: 'ref-test', code, planId }, (r) => `Created ${r.friend}`)}>Create test friend</button>
            </div>

            <div className="card">
              <h3>Friends · {R.links.length}</h3>
              {R.links.length === 0 && <p className="empty" style={{ paddingTop: 8 }}>No invited friends yet.</p>}
              {R.links.map((l) => (
                <div className="row" key={l.friend}>
                  <div>
                    {l.friend}
                    <small>by {l.inviter} · spent ${fmtUsd(l.spendUsd)}{l.gift ? ' · gift given' : ''}{l.rebate > 0 ? ` · ${l.rebate}% rebate` : ''}</small>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <b>${l.rewardUsd.toFixed(2)}</b>
                    <small>{l.rewarded ? 'rewarded' : 'pending'}</small>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {tab === 'send' && (
        <div className="card adm-stack">
          <h3>Send a notification</h3>
          <div className="field" style={{ marginTop: 4 }}>
            <select id="to" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="all">All users</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.id}</option>)}
            </select>
            <label htmlFor="to">To</label>
          </div>
          <div className="field" style={{ marginTop: 4 }}>
            <input id="nt" placeholder=" " maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />
            <label htmlFor="nt">Title</label>
          </div>
          <textarea aria-label="Message" placeholder="Message (optional)" maxLength={240} value={msg} onChange={(e) => setMsg(e.target.value)} />
          <button
            className="btn"
            disabled={sendDisabled}
            onClick={async () => {
              if (await run({ action: 'notify', userId: to, title, body: msg }, 'Sent')) {
                setTitle('');
                setMsg('');
              }
            }}
          >
            Send
          </button>
        </div>
      )}
      {toast}
    </>
  );
}
