'use client';
import { useCallback, useEffect, useState } from 'react';
import { halls, fmtTh } from '@/lib/data';
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
const KYC = { none: 'Not verified', pending: 'Pending review', verified: 'Verified' };

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

function Login({ onDone }) {
  const [token, setToken] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (busy || !token) return;
    setBusy(true);
    setErr('');
    try {
      const r = await call('POST', '/api/admin/login', { token });
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
        <p className="mute">Enter the admin token to continue.</p>
        <div className="field">
          <input
            id="tk"
            type="password"
            autoComplete="current-password"
            placeholder=" "
            className={err ? 'bad' : ''}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <label htmlFor="tk">Admin token</label>
        </div>
        {err && <div className="ferr" role="alert">{err}</div>}
        <button className="btn" style={{ marginTop: 16 }} disabled={busy || !token}>Sign in</button>
      </form>
    </div>
  );
}

export default function Admin() {
  const [state, setState] = useState('loading'); // loading, login, off, error, ready
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('overview');
  const [busy, setBusy] = useState(false);
  const [to, setTo] = useState('all');
  const [title, setTitle] = useState('');
  const [msg, setMsg] = useState('');
  const [toast, show] = useToast();

  const load = useCallback(async () => {
    try {
      const r = await call('GET', '/api/admin');
      if (r.status === 200) {
        setData(r);
        setState('ready');
      } else if (r.status === 401) setState('login');
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
      show(ok ? okText : r.error || 'Failed.');
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
  if (state === 'login') return <Login onDone={() => { setState('loading'); load(); }} />;
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

  const { stats, users, mode, btcUsd, serial } = data;
  const miners = users.flatMap((u) => u.miners.map((m) => ({ ...m, userId: u.id })));
  const sendDisabled = busy || !title.trim();

  return (
    <>
      <div className="top">
        <h2>Admin</h2>
        <button className="swap" style={{ width: 'auto', margin: 0, padding: '0 16px' }} onClick={signOut}>Sign out</button>
      </div>

      <div className="tabs" role="group" aria-label="Admin sections">
        {[['overview', 'Overview'], ['users', 'Users'], ['miners', 'Miners'], ['send', 'Send']].map(([k, l]) => (
          <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>
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
          <div className="card">
            <h3>System</h3>
            <div className="row"><span className="mute">Storage</span><b>{mode}</b></div>
            <div className="row"><span className="mute">BTC fallback price</span><b>${btcUsd.toLocaleString()}</b></div>
            <div className="row"><span className="mute">Latest miner ID</span><b className="serial">{formatSerial(serial)}</b></div>
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
              <div className="row"><span className="mute">Miners</span><b>{u.miners.length}</b></div>
              <div className="row"><span className="mute">Withdrawn</span><b>{u.withdrawn.toFixed(5)} BTC</b></div>
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
            </div>
          ))}
        </div>
      )}

      {tab === 'miners' && (
        <div className="adm-stack">
          {miners.length === 0 && <div className="card"><p className="empty">No miners yet.</p></div>}
          {miners.map((m) => (
            <div className="card" key={m.serial}>
              <div className="cardhead">
                <h3>{m.name}</h3>
                <span className={m.online ? 'up' : 'mute'}>{m.online ? 'Online' : 'Offline'}</span>
              </div>
              <span className="serial">{m.serial}</span>
              <p className="adm-meta">
                {m.userId} · {halls[m.hall]?.name || m.hall} · ${m.dailyUsd.toFixed(2)}/day · Day {m.elapsed}/{m.days} · ends {m.ends}
              </p>
              <div className="adm-actions">
                <button className="btn ghost danger" disabled={busy} onClick={() => window.confirm(`Remove ${m.serial}? This cannot be undone.`) && run({ action: 'miner', userId: m.userId, serial: m.serial, op: 'delete' }, 'Miner removed')}>Remove</button>
                <button className="btn ghost" disabled={busy} onClick={() => run({ action: 'miner', userId: m.userId, serial: m.serial, op: m.online ? 'offline' : 'online' }, m.online ? 'Set offline' : 'Set online')}>
                  {m.online ? 'Set offline' : 'Set online'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

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
