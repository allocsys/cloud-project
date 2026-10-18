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
const KYC = { none: 'Not verified', pending: 'Pending review', verified: 'Verified' };
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
];

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

function HallForm({ draft, set, busy, onSave, onCancel }) {
  return (
    <div className="adm-form">
      <Field id="hn" label="Name" value={draft.name} onChange={(v) => set('name', v)} maxLength={40} />
      <Field id="hp" label="Location" value={draft.place} onChange={(v) => set('place', v)} maxLength={40} />
      <Field id="hw" label="Power source" value={draft.power} onChange={(v) => set('power', v)} maxLength={60} />
      <Field id="he" label="Efficiency (e.g. 17.5 J/TH)" value={draft.efficiency} onChange={(v) => set('efficiency', v)} maxLength={20} />
      <Field id="hr" label="Rig model" value={draft.rig} onChange={(v) => set('rig', v)} maxLength={40} />
      <Field id="hx" label="Net rate (USD per TH/s per day)" inputMode="decimal" value={draft.net} onChange={(v) => set('net', v)} />
      <p className="fine" style={{ margin: '12px 0 0' }}>
        Changing the rate updates the daily payout of every miner in this hall and of the plans that use it.
      </p>
      <div className="adm-actions">
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
        <button className="btn" disabled={busy} onClick={onSave}>Save</button>
      </div>
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

  const { stats, users, mode, btcUsd, serial, catalog: cat } = data;
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
  const hallDraft = (h) => ({ name: h.name, place: h.place, power: h.power, efficiency: h.efficiency, rig: h.rig, net: String(h.net) });

  async function savePlan() {
    const d = edit.draft;
    const plan = { id: edit.id === 'new' ? undefined : edit.id, name: d.name, th: d.th, price: d.price, days: d.days, hall: d.hall, blurb: d.blurb, featured: d.featured === 'yes' };
    if (await run({ action: 'plan-save', plan }, 'Plan saved')) setEdit(null);
  }

  async function saveHall() {
    const ok = await run(
      { action: 'hall-save', id: edit.id, hall: edit.draft },
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
        {[['overview', 'Overview'], ['users', 'Users'], ['plans', 'Plans'], ['referrals', 'Referrals'], ['send', 'Send']].map(([k, l]) => (
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

      {tab === 'plans' && (
        <div className="adm-stack">
          <div className="card">
            <div className="cardhead">
              <h3>Plans</h3>
              <button className="swap" style={SM} disabled={busy} onClick={() => setEdit({ kind: 'plan', id: 'new', draft: planDraft(null) })}>Add plan</button>
            </div>
            {edit?.kind === 'plan' && edit.id === 'new' && planForm(true)}
            {cat.plans.map((p) =>
              edit?.kind === 'plan' && edit.id === p.id ? (
                <div key={p.id} className="adm-edit">{planForm(false)}</div>
              ) : (
                <button key={p.id} type="button" className="row adm-click" aria-label={`Edit ${p.name}`} onClick={() => setEdit({ kind: 'plan', id: p.id, draft: planDraft(p) })}>
                  <div>
                    {p.name}{p.featured ? ' ★' : ''}
                    <small>{fmtTh(p.th)} TH/s · {p.days} days · {cat.halls[p.hall]?.name}</small>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <b>${fmtUsd(p.price)}</b>
                    <small>~{p.daily}/day</small>
                  </div>
                </button>
              )
            )}
          </div>

          <div className="card">
            <div className="cardhead"><h3>Halls</h3></div>
            {Object.entries(cat.halls).map(([id, h]) =>
              edit?.kind === 'hall' && edit.id === id ? (
                <div key={id} className="adm-edit">
                  <HallForm draft={edit.draft} set={setDraft} busy={busy} onSave={saveHall} onCancel={() => setEdit(null)} />
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
                    <small>by {l.inviter} · spent ${fmtUsd(l.spendUsd)}{l.gift ? ' · gift given' : ''}</small>
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
