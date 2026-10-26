'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fmtTh, fmtUsd } from '@/lib/data';
import { formatSerial } from '@/lib/contracts';
import { useToast } from '@/components/Toast';
import { SMART_BUDGETS, SMART_TABLE } from '@/lib/smart';
import { BOOST, TICKETS, BOOST_DEFAULTS, marginOf } from '@/lib/boost';
import { trimAmount } from '@/lib/pay-coins';

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

// Confirm, text and notice sheets, in the page instead of the browser's dialogs. The Admin page mounts one <AskHost />;
// ask() resolves true/false, askText() resolves the typed text or null, tell() resolves when closed. Without a host they fall back to the browser's own.
let askHost = null;
const ask = (text, o = {}) => (askHost ? askHost({ kind: 'confirm', text, ...o }) : Promise.resolve(window.confirm(text)));
const askText = (text, o = {}) => (askHost ? askHost({ kind: 'text', text, ...o }) : Promise.resolve(window.prompt(text, '')));
const tell = (text) => (askHost ? askHost({ kind: 'alert', text }) : Promise.resolve(window.alert(text)));

function AskHost() {
  const [q, setQ] = useState(null);
  const [val, setVal] = useState('');
  useEffect(() => {
    askHost = (o) =>
      new Promise((resolve) => {
        setVal('');
        setQ({ ...o, resolve });
      });
    return () => {
      askHost = null;
    };
  }, []);
  if (!q) return null;
  const text = q.kind === 'text';
  const done = (v) => {
    q.resolve(v);
    setQ(null);
  };
  const cancel = () => done(text ? null : q.kind === 'alert' ? undefined : false);
  const okOff = text && q.required && !val.trim();
  return (
    <div className="adm-ask" role="presentation" onClick={cancel}>
      <div className="adm-ask-box" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <p>{q.text}</p>
        {text && (
          <div className="field" style={{ marginTop: 14 }}>
            <input id="askv" autoFocus placeholder=" " maxLength={q.maxLength} value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !okOff && done(val.trim())} />
            <label htmlFor="askv">{q.label || 'Note'}</label>
          </div>
        )}
        <div className="adm-actions">
          {q.kind !== 'alert' && <button className="btn ghost" onClick={cancel}>Cancel</button>}
          <button className={`btn${q.danger ? ' danger' : ''}`} disabled={okOff} onClick={() => done(text ? val.trim() : q.kind === 'alert' ? undefined : true)}>{q.ok || 'OK'}</button>
        </div>
      </div>
    </div>
  );
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

// Smart Mining: sell on/off, the pay table for new purchases (ten rates by budget on a 90 day term, plus what 120 and 150 days add;
// shown in percent, stored as fractions), and which coins may be picked. See lib/server/smart-admin.js.
const pctText = (p) => String(Math.round(p * 1e6) / 1e4);
const draftOf = (t) => ({ rates: t.rates.map(pctText), b120: pctText(t.bonus[120]), b150: pctText(t.bonus[150]) });
function SmartCard({ smart, busy, run }) {
  const set = smart?.settings || { enabled: true, table: SMART_TABLE };
  const table = set.table || SMART_TABLE;
  const coins = smart?.coins || [];
  const days = smart?.days || [];
  const cost = smart?.cost;
  const key = JSON.stringify(table);
  const [d, setD] = useState(() => draftOf(table));
  useEffect(() => setD(draftOf(JSON.parse(key))), [key]);
  const asFraction = (v) => Number(String(v).trim().replace(',', '.')) / 100;
  const save = () => run({ action: 'smart-settings', enabled: set.enabled, rates: d.rates.map(asFraction), bonus: { 120: asFraction(d.b120), 150: asFraction(d.b150) } }, 'Smart Mining pay table saved');
  return (
    <Fold title="Smart Mining" sub={set.enabled ? 'Selling' : 'Off'} start>
      <div className="row"><span className="mute">Selling</span><b>{set.enabled ? 'On' : 'Off'}</b></div>
      <span className="eyebrow adm-sub">Net profit a day at the reference market, 90 days (%)</span>
      {SMART_BUDGETS.map((b, i) => (
        <Field key={b} id={`smr${i}`} label={`$${b.toLocaleString('en-US')}`} inputMode="decimal" value={d.rates[i]} onChange={(v) => setD({ ...d, rates: d.rates.map((x, j) => (j === i ? v : x)) })} />
      ))}
      <Field id="smb1" label="Added on 120 days (% a day)" inputMode="decimal" value={d.b120} onChange={(v) => setD({ ...d, b120: v })} />
      <Field id="smb2" label="Added on 150 days (% a day)" inputMode="decimal" value={d.b150} onChange={(v) => setD({ ...d, b150: v })} />
      <div className="adm-actions">
        <button className="btn" disabled={busy} onClick={save}>Save pay table</button>
        <button className="btn" disabled={busy} onClick={() => run({ action: 'smart-settings', enabled: !set.enabled }, set.enabled ? 'Smart Mining is off' : 'Smart Mining is on')}>
          {set.enabled ? 'Turn off' : 'Turn on'}
        </button>
      </div>
      <p className="fine" style={{ margin: '8px 0 12px' }}>Between two budgets the rate follows the log of the budget, and it stays flat above $10,000. Each rate must be between 0.1% and 1%. Off hides Smart Mining and refuses new purchases; miners already running keep paying. A new table applies to purchases made after saving, each miner keeps the rate and reserve band it was bought with.</p>
      <span className="eyebrow adm-sub">Coins and their reference rig</span>
      <div className="row"><span className="mute">Electricity price</span><b>{cost?.inUse ? `$${cost.inUse} per kWh (live)` : cost?.auto === false ? 'Each coin\'s own (live price off)' : 'Each coin\'s own (no live price)'}</b></div>
      {cost?.live && <p className="fine" style={{ margin: '4px 0 0' }}>Eurostat industrial price for {cost.live.period}, average of Iceland and Norway, €{cost.live.eur} per kWh, at the ECB rate of {cost.live.rate} on {cost.live.rateDate} (Frankfurter). Eurostat updates twice a year. If the feed is down or older than 30 days, each coin's own price below is used.</p>}
      <div className="adm-actions">
        <button className="btn ghost" disabled={busy} onClick={() => run({ action: 'smart-settings', enabled: set.enabled, kwhAuto: !(set.kwhAuto !== false) }, set.kwhAuto !== false ? 'Live electricity price is off' : 'Live electricity price is on')}>
          {set.kwhAuto !== false ? 'Use each coin\'s own price' : 'Use the live price'}
        </button>
      </div>
      <p className="fine" style={{ margin: '0 0 4px' }}>A coin's daily net profit = gross for the rig minus the rig's power cost, in USD. Every coin is measured against one anchor{coins.find((c) => c.ref !== null) ? ` (${usd2(coins.find((c) => c.ref !== null).ref)} a day)` : ''}. The rig figures are editable defaults, and a change only applies to new readings.</p>
      {coins.map((c) => (
        <CoinRow key={c.symbol} c={c} busy={busy} run={run} />
      ))}
      <span className="eyebrow adm-sub">Net profit per rig by day (USD)</span>
      {days.length === 0 && <p className="fine" style={{ margin: 0 }}>No market data yet.</p>}
      {days.map((r, i) => (
        <div className="row adm-m" key={r.day}>
          <div>
            {dayText(r.day)}
            <small>
              {coins.map((c) => (
                <span key={c.symbol} style={{ marginRight: 10, fontWeight: (r.pick || r.best) === c.symbol ? 700 : 400 }}>{c.symbol} {r.nets[c.symbol] === undefined || r.nets[c.symbol] === null ? 'n/a' : usd2(r.nets[c.symbol])}</span>
              ))}
            </small>
          </div>
          <b>{r.pick ? `${r.pick} ✓` : r.best ? `${r.best} (leading)` : ''}</b>
        </div>
      ))}
      <p className="fine" style={{ margin: '8px 0 0' }}>A tick means the coin is locked in for that finished day. Today is still moving, so the coin shown is only the one in the lead.</p>
    </Fold>
  );
}

const usd2 = (n) => `$${(Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dayText = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// One Smart coin: on/off, today's net profit and the reference rig (hashrate in the coin's own unit, watts, price of a kWh).
function CoinRow({ c, busy, run }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ rigHash: String(c.rigHash ?? ''), rigWatts: String(c.rigWatts ?? ''), kwh: String(c.kwh ?? '') });
  const save = async () => {
    if (await run({ action: 'smart-coin-rig', symbol: c.symbol, ...f }, `${c.symbol} rig saved`)) setOpen(false);
  };
  return (
    <div className="adm-m">
      <div className="row">
        <div>
          {c.symbol} · {c.name}
          <small>{c.algo} · {c.days} day{c.days === 1 ? '' : 's'} of data{c.net === null ? '' : ` · latest ${usd2(c.net)} a day`}{c.ref === null ? ' · no reference yet' : ''}{c.enabled ? '' : ' · off'}</small>
          <small>Rig {c.rigHash ?? '?'} {c.unit} · {c.rigWatts ?? '?'} W · ${c.kwh ?? '?'} per kWh</small>
        </div>
        <div className="adm-btns">
          <button className="btn ghost" disabled={busy} onClick={() => setOpen(!open)}>{open ? 'Close' : 'Edit rig'}</button>
          <button className="btn ghost" disabled={busy} onClick={() => run({ action: 'smart-coin', symbol: c.symbol, enabled: !c.enabled }, c.enabled ? `${c.symbol} turned off` : `${c.symbol} turned on`)}>
            {c.enabled ? 'Turn off' : 'Turn on'}
          </button>
        </div>
      </div>
      {open && (
        <div className="adm-form">
          <Field id={`rh${c.symbol}`} label={`Rig hashrate (${c.unit})`} inputMode="decimal" value={f.rigHash} onChange={(v) => setF({ ...f, rigHash: v })} />
          <Field id={`rw${c.symbol}`} label="Rig power (watts)" inputMode="decimal" value={f.rigWatts} onChange={(v) => setF({ ...f, rigWatts: v })} />
          <Field id={`rk${c.symbol}`} label="Electricity (USD per kWh)" inputMode="decimal" value={f.kwh} onChange={(v) => setF({ ...f, kwh: v })} />
          <div className="adm-actions">
            <button className="btn" disabled={busy} onClick={save}>Save rig</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Profit guard: switches ASICs and Smart Mining off on days that would not pay. Rules in lib/guard.js, storage in lib/server/guard.js.
// margin and buffer are typed and saved in percent. Hand flips can start now (today, UTC) or tomorrow; finished days never change.
const HAND = { auto: 'Automatic', paused: 'Paused by hand', active: 'Kept on by hand' };
function GuardCard({ guard, busy, run }) {
  const s = guard?.settings;
  const [draft, setDraft] = useState(null);
  const [from, setFrom] = useState('tomorrow');
  const [test, setTest] = useState(null); // the last backtest: what the rule would have done over the last 30 days
  if (!s) return null;
  const d = draft || { asicsAuto: s.asicsAuto, smartAuto: s.smartAuto, mode: s.mode, margin: String(s.margin), buffer: String(s.buffer) };
  const put = (k, v) => setDraft({ ...d, [k]: v });
  const lastText = (t) => (t ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : 'never');
  const daysText = (list) => (list && list.length ? list.map(lastText).join(', ') : 'none');
  return (
    <Fold title="Profit guard" sub={(guard.scopes || []).some((sc) => sc.pausedToday) ? `${(guard.scopes || []).filter((sc) => sc.pausedToday).length} paused today` : 'All running'}>
      <p className="fine" style={{ margin: '0 0 4px' }}>Switches a hall off for a whole UTC day when that day would not be profitable. A paused day pays nothing. Each day is decided once it is over, from its final market, and then never changes.</p>
      <Pick id="gpa" label="ASICs: automatic guard" value={d.asicsAuto ? 'on' : 'off'} onChange={(v) => put('asicsAuto', v === 'on')}>
        <option value="on">On</option>
        <option value="off">Off</option>
      </Pick>
      <Pick id="gps" label="Smart Mining: automatic guard" value={d.smartAuto ? 'on' : 'off'} onChange={(v) => put('smartAuto', v === 'on')}>
        <option value="on">On</option>
        <option value="off">Off</option>
      </Pick>
      <Pick id="gpm" label="A paused day" value={d.mode} onChange={(v) => put('mode', v)}>
        <option value="extend">Extends the term by a day</option>
        <option value="zero">Uses up a day and pays zero</option>
      </Pick>
      <Field id="gpg" label="Profit margin to count a day (%, 0 = break even)" inputMode="decimal" value={d.margin} onChange={(v) => put('margin', v)} />
      <Field id="gpb" label="Buffer to resume (%)" inputMode="decimal" value={d.buffer} onChange={(v) => put('buffer', v)} />
      <p className="fine" style={{ margin: '12px 0 0' }}>Once paused, a hall resumes only when its profit share is back above margin plus buffer. Each Smart Mining plan is judged on its own payout and term, so the plans with the lowest rates and shortest terms pause first; the Smart row shows the first and the last to pause. The paused-day setting applies to miners bought after saving; each miner keeps the one it was bought with. Changes apply to days not yet decided.</p>
      <div className="adm-actions">
        <button className="btn ghost" disabled={busy} onClick={() => run({ action: 'guard-backtest', asicsAuto: d.asicsAuto, smartAuto: d.smartAuto, margin: d.margin, buffer: d.buffer }, (r) => { setTest(r); return 'Tested the last 30 days'; })}>Test last 30 days</button>
        <button className="btn" disabled={busy || !draft} onClick={async () => { if (await run({ action: 'guard-settings', ...d }, 'Profit guard saved')) setDraft(null); }}>Save</button>
      </div>
      {test && (
        <div style={{ marginTop: 8 }}>
          <p className="fine" style={{ margin: '0 0 4px' }}>Last {test.days} days ({test.withData} with market data), margin {test.margin}% and buffer {test.buffer}%. The rule only; hand flips are not counted. Nothing was saved.</p>
          {test.scopes.map((x) => (
            <div className="row adm-m" key={x.id}>
              <div>
                {x.name}
                <small>{x.count ? x.days.map(lastText).join(', ') : 'No paused days'}</small>
              </div>
              <b>{x.count}</b>
            </div>
          ))}
        </div>
      )}
      <span className="eyebrow adm-sub">By hand</span>
      <Pick id="gpw" label="Takes effect" value={from} onChange={setFrom}>
        <option value="tomorrow">From tomorrow (UTC)</option>
        <option value="now">From today (UTC)</option>
      </Pick>
      {(guard.scopes || []).map((sc) => (
        <div className="row adm-m" key={sc.id}>
          <div>
            {sc.name}
            <small>{sc.pausedToday ? 'Paused today' : 'Running today'} · {HAND[sc.manual] || sc.manual}{sc.manualNext !== sc.manual ? ` (then ${String(HAND[sc.manualNext] || sc.manualNext).toLowerCase()})` : ''} · last auto pause {lastText(sc.lastPaused)}</small>
            <small>Paused in the last 14 days: {daysText(sc.pausedDays)}</small>
            {(sc.tiers || []).map((t) => (
              <small key={t.name}>{t.name}: {t.pausedToday ? 'paused today' : 'running today'} · last 14 days: {daysText(t.pausedDays)}</small>
            ))}
          </div>
          <div className="adm-btns">
            <button className="btn ghost" disabled={busy || sc.manualNext === 'paused'} onClick={() => run({ action: 'guard-manual', scope: sc.id, state: 'paused', when: from }, 'Pause saved')}>Pause</button>
            <button className="btn ghost" disabled={busy || sc.manualNext === 'active'} onClick={() => run({ action: 'guard-manual', scope: sc.id, state: 'active', when: from }, 'Resume saved')}>Resume</button>
            <button className="btn ghost" disabled={busy || sc.manualNext === 'auto'} onClick={() => run({ action: 'guard-manual', scope: sc.id, state: 'auto', when: from }, 'Back to automatic')}>Auto</button>
          </div>
        </div>
      ))}
    </Fold>
  );
}

// First-buy bonus: extra hashrate on a user's first purchase paid with crypto. Rules in lib/first-bonus.js, storage in lib/server/first-bonus.js.
const fbDraft = (v) => ({ pct: String(v.pct), capTh: String(v.capTh), capUsd: String(v.capUsd), minUsd: String(v.minUsd), until: v.until ? new Date(v.until).toISOString().slice(0, 10) : '' });
function FirstBonusCard({ fb, busy, run }) {
  const s = fb || { enabled: false, pct: 10, capTh: 5, capUsd: 50, minUsd: 50, until: null };
  const key = JSON.stringify(s);
  const [d, setD] = useState(() => fbDraft(s));
  useEffect(() => setD(fbDraft(JSON.parse(key))), [key]);
  return (
    <Fold title="First-buy bonus" sub={s.enabled ? `On · ${s.pct}%` : 'Off'}>
      <div className="row"><span className="mute">Bonus</span><b>{s.enabled ? 'On' : 'Off'}</b></div>
      <Field id="fbp" label="Bonus (% of the purchase)" inputMode="decimal" value={d.pct} onChange={(v) => setD({ ...d, pct: v })} />
      <Field id="fbt" label="Max bonus for ASICs (TH/s)" inputMode="decimal" value={d.capTh} onChange={(v) => setD({ ...d, capTh: v })} />
      <Field id="fbu" label="Max bonus for Smart Mining (USD of budget)" inputMode="decimal" value={d.capUsd} onChange={(v) => setD({ ...d, capUsd: v })} />
      <Field id="fbm" label="Min purchase (USD)" inputMode="decimal" value={d.minUsd} onChange={(v) => setD({ ...d, minUsd: v })} />
      <Field id="fbe" label="Last day, UTC (2026-12-31, empty = no end)" value={d.until} onChange={(v) => setD({ ...d, until: v })} />
      <div className="adm-actions">
        <button className="btn" disabled={busy} onClick={() => run({ action: 'firstbonus-settings', ...d }, 'First-buy bonus saved')}>Save</button>
        <button className="btn" disabled={busy} onClick={() => run({ action: 'firstbonus-settings', enabled: !s.enabled }, s.enabled ? 'First-buy bonus is off' : 'First-buy bonus is on')}>
          {s.enabled ? 'Turn off' : 'Turn on'}
        </button>
      </div>
      <p className="fine" style={{ margin: '8px 0 0' }}>A user's first purchase paid with crypto gets extra hashrate for the whole term. ASICs get extra TH/s (the percent of the size, up to the TH/s cap). Smart Mining gets a higher profit rate by the same percent, up to the USD cap measured on the budget; the budget that comes back does not change. A first purchase paid from the balance gets nothing and uses up the chance. Not for renewals or admin grants. It applies to purchases made after saving, each miner keeps the bonus it started with.</p>
    </Fold>
  );
}

// Boost tickets: a 2 hour hashrate boost with a prize draw. Rules in lib/boost.js, storage in lib/server/boost.js. The chance is typed per
// ticket in percent; the margin is only shown (1 - (boost pay + chance x prize) / price). A negative margin turns red and asks twice before saving.
const bcDraft = (v) => ({
  chance: Object.fromEntries(TICKETS.map((t) => [t.id, String(v.chance[t.id])])),
  shown: Object.fromEntries(TICKETS.map((t) => [t.id, v.shown?.[t.id] == null ? '' : String(v.shown[t.id])])), // empty = users see the real chance
});
const pctOf = (v) => Number(String(v).trim().replace(',', '.'));
const marginText = (m) => `${(Math.round(m * 1000) / 10).toFixed(1)}%`;
function BoostCard({ bs, busy, run }) {
  const s = bs || BOOST_DEFAULTS;
  const key = JSON.stringify(s);
  const [d, setD] = useState(() => bcDraft(s));
  const [edited, setEdited] = useState(false); // typed and not saved yet: a reload (Turn on, Turn off) must not wipe it
  useEffect(() => {
    if (!edited) setD(bcDraft(JSON.parse(key)));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const type = (kind, id, v) => {
    setEdited(true);
    setD((x) => ({ ...x, [kind]: { ...x[kind], [id]: v } }));
  };
  const losing = TICKETS.filter((t) => String(d.chance[t.id]).trim() !== '' && marginOf(t, pctOf(d.chance[t.id])) < 0);
  const save = async () => {
    if (losing.length && !(await ask(`The $${losing.map((t) => t.price).join(', $')} ticket would lose money at this chance. Save anyway?`, { ok: 'Save', danger: true }))) return;
    if (await run({ action: 'boost-settings', chance: d.chance, shown: d.shown, confirm: losing.length > 0 }, 'Boost tickets saved')) setEdited(false);
  };
  return (
    <Fold title="Boost tickets" sub={s.enabled ? 'On' : 'Off'}>
      <div className="row"><span className="mute">Tickets</span><b>{s.enabled ? 'On' : 'Off'}</b></div>
      {TICKETS.map((t) => {
        const x = pctOf(d.chance[t.id]);
        const ok = String(d.chance[t.id]).trim() !== '' && Number.isFinite(x) && x >= 0 && x <= BOOST.maxChance;
        const m = ok ? marginOf(t, x) : null;
        return (
          <div className="adm-m" key={t.id}>
            <div className="row">
              <div>
                ${t.price} ticket
                <small>{t.th.toLocaleString('en-US')} TH/s for {BOOST.hours} h · pays ${t.pay.toFixed(2)} · prize ${t.prize.toLocaleString('en-US')} · up to {t.max} at once</small>
              </div>
              <b style={m !== null && m < 0 ? { color: '#e5484d' } : undefined}>{m === null ? '—' : `Margin ${marginText(m)}`}</b>
            </div>
            <Field id={`bc${t.id}`} label={`Real chance (%) for the $${t.price} ticket`} inputMode="decimal" value={d.chance[t.id]} onChange={(v) => type('chance', t.id, v)} />
            <Field id={`bs${t.id}`} label={`Shown chance (%) for the $${t.price} ticket, empty = same`} inputMode="decimal" value={d.shown[t.id]} onChange={(v) => type('shown', t.id, v)} />
            {m !== null && m < 0 && <p className="fine" style={{ margin: '4px 0 0', color: '#e5484d' }}>At this chance the ${t.price} ticket loses money (each one costs more than it brings in).</p>}
          </div>
        );
      })}
      {edited && <p className="fine" style={{ margin: '8px 0 0' }}>You have unsaved changes. Tap Save.</p>}
      <div className="adm-actions">
        <button className="btn" disabled={busy} onClick={save}>Save</button>
        <button className="btn" disabled={busy} onClick={() => run({ action: 'boost-settings', enabled: !s.enabled }, s.enabled ? 'Boost tickets are off' : 'Boost tickets are on')}>
          {s.enabled ? 'Turn off' : 'Turn on'}
        </button>
      </div>
      <p className="fine" style={{ margin: '8px 0 0' }}>Each purchase is its own boost of {BOOST.hours} hours with its own draw, made at purchase and shown when the boost ends. The boost pay (flat ${BOOST.rate} per TH/s per day) and any prize go to the balance at the end. Margin = 1 - (boost pay + real chance x prize) / price, so it moves with the real chance and is not typed. The real chance decides the draw; the shown chance is what users see on the cards (empty = the real one). A new chance applies to tickets bought after saving; a running boost keeps the chances it was bought with. Off hides the tickets and refuses new purchases; running boosts still finish and pay.</p>
    </Fold>
  );
}

// A card that stays closed until tapped: the title and a one-line summary show, the body opens below. Drafts live in the parent, so closing keeps them.
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
        {isNew ? 'The new hall can host miners, but ASICs power is priced from the three core halls.' : 'Changing the rate updates the daily payout of every miner in this hall and the price of new ASICs power sold from it.'}
      </p>
      <div className="adm-actions">
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
        <button className="btn" disabled={busy} onClick={onSave}>Save</button>
      </div>
      {canDelete && <button className="swap danger" disabled={busy} onClick={onDelete}>Delete hall</button>}
    </div>
  );
}

const SMART_KIND = { asic: 'ASIC hall', gpu: 'GPU hall', cpu: 'CPU hall' };

// One Smart Mining hall. Its kind and the coins it mines are fixed; only the details shown to users can change.
function SmartHallForm({ draft, set, busy, asic, onSave, onCancel }) {
  return (
    <div className="adm-form">
      <Field id="shn" label="Name" value={draft.name} onChange={(v) => set('name', v)} maxLength={40} />
      <Field id="shp" label="Location" value={draft.place} onChange={(v) => set('place', v)} maxLength={40} />
      <Field id="shw" label="Power source" value={draft.power} onChange={(v) => set('power', v)} maxLength={60} />
      {asic && <Field id="she" label="Efficiency (e.g. 12.0 J/TH)" value={draft.efficiency} onChange={(v) => set('efficiency', v)} maxLength={20} />}
      <Field id="shr" label="Rig" value={draft.rig} onChange={(v) => set('rig', v)} maxLength={40} />
      <p className="fine" style={{ margin: '12px 0 0' }}>Shown on the Smart Mining miner page. It does not change what a miner earns.</p>
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

// Section tabs: one scrolling row of pills. The open one slides to the middle. items: [key, label, badge?].
function Tabs({ items, value, onPick }) {
  const box = useRef(null);
  useEffect(() => {
    const b = box.current;
    const el = b?.querySelector('[aria-pressed=true]');
    if (b && el) b.scrollTo({ left: el.offsetLeft - (b.clientWidth - el.offsetWidth) / 2, behavior: 'smooth' });
  }, [value]);
  return (
    <div className="adm-tabs" role="group" aria-label="Admin sections" ref={box}>
      {items.map(([k, l, n]) => (
        <button key={k} aria-pressed={value === k} onClick={() => onPick(k)}>
          {l}
          {n > 0 && <b>{n}</b>}
        </button>
      ))}
    </div>
  );
}

// Small status label: tone is ok (green), warn (gold), bad (red) or empty (grey).
const Pill = ({ tone, children }) => <span className={`adm-pill${tone ? ` ${tone}` : ''}`}>{children}</span>;

// Open / All switch for a list of things to act on.
function Filter({ value, onPick, open, all }) {
  return (
    <div className="minitabs adm-filter" role="group" aria-label="Filter">
      <button aria-pressed={value === 'open'} onClick={() => onPick('open')}>Open · {open}</button>
      <button aria-pressed={value === 'all'} onClick={() => onPick('all')}>All · {all}</button>
    </div>
  );
}

// Gateway tab: the payment gateway, fetched through the app server (the gateway secret never reaches the browser).
const NET = { btc: 'Bitcoin', eth: 'Ethereum', bsc: 'BNB Chain', pol: 'Polygon', trx: 'Tron', sol: 'Solana' };
const INV = { pending: 'Waiting', confirming: 'Confirming', paid: 'Paid', partial: 'Partly paid', expired: 'Expired', failed: 'Failed' };
const shortId = (s) => (s && s.length > 18 ? `${s.slice(0, 8)}…${s.slice(-6)}` : s || '');
const agoText = (s) => (s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`);
const WARN = { color: 'var(--gold)' };

// Which provider new crypto payments use. Switching takes a few seconds and needs no redeploy; open orders still finish.
const PROVIDERS = { nowpayments: 'NOWPayments', gateway: 'Gateway' };
function ProviderCard({ pp, busy, run }) {
  if (!pp) return null;
  return (
    <div className="card">
      <h3>Checkout</h3>
      {Object.entries(PROVIDERS).map(([k, name]) => (
        <div className="row adm-m" key={k}>
          <div>
            {name}
            <small>{!pp.ready[k] ? 'Not set up' : pp.active === k ? 'In use' : 'Ready'}</small>
          </div>
          <button className="btn ghost" disabled={busy || pp.active === k || !pp.ready[k]} onClick={() => ask(`Send new payments through ${name}?`, { ok: 'Switch' }).then((yes) => yes && run({ action: 'pay-provider', provider: k }, `Now using ${name}`))}>
            {pp.active === k ? 'In use' : 'Use'}
          </button>
        </div>
      ))}
      <p className="fine" style={{ margin: '8px 0 0' }}>Orders already open finish with the provider that made them.</p>
    </div>
  );
}

function GatewayTab({ pp, run, lock, g, reload }) {
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try {
      await reload();
    } finally {
      setBusy(false);
    }
  }, [reload]);
  useEffect(() => {
    load();
  }, [load]);

  // The money was returned by hand: ask for a short note, mark it, reload.
  const handle = async (u) => {
    const note = await askText('Mark this payment as handled?', { label: 'Note (how it was returned)', maxLength: 80, ok: 'Handled' });
    if (note === null) return;
    setBusy(true);
    try {
      const r = await call('POST', '/api/admin/gateway', { network: u.network, txid: u.txid, vout: u.vout, note });
      if (!r.ok) await tell(r.error || 'Could not save.');
    } catch {
      await tell('No connection. Try again.');
    }
    await load();
  };

  // A waiting invoice nobody will pay: expire it so its order closes too.
  const closeInv = async (i) => {
    if (!(await ask('Close this invoice? The order is cancelled. Do it only if nobody will pay.', { ok: 'Close' }))) return;
    setBusy(true);
    try {
      const r = await call('POST', '/api/admin/gateway', { close: i.id });
      if (!r.ok) await tell(r.error || 'Could not save.');
    } catch {
      await tell('No connection. Try again.');
    }
    await load();
  };

  // Pause a network that is not in use (no new invoices, no scanning) or bring it back.
  const toggle = async (n) => {
    const name = NET[n.network] || n.network;
    const text = n.paused
      ? `Resume ${name}? It takes new payments again.`
      : `Pause ${name}? It takes no new payments and is not scanned. Payments sent to its address while paused may not be tracked.`;
    if (!(await ask(text, { ok: n.paused ? 'Resume' : 'Pause' }))) return;
    setBusy(true);
    try {
      const r = await call('POST', '/api/admin/gateway', { network: n.network, paused: !n.paused });
      if (!r.ok) await tell(r.error || 'Could not save.');
    } catch {
      await tell('No connection. Try again.');
    }
    await load();
  };

  const card = <ProviderCard pp={pp} busy={lock || busy} run={run} />;
  if (!g) return <div className="adm-stack">{card}<p className="empty" style={{ textAlign: 'center' }}>Loading…</p></div>;
  if (!g.ok) {
    return (
      <div className="adm-stack">
        {card}
        <div className="card">
          <h3>Gateway</h3>
          <p className="fine" style={{ margin: '0 0 12px' }}>{g.error || 'Could not load.'}</p>
          <button className="btn" disabled={busy} onClick={load}>Retry</button>
        </div>
      </div>
    );
  }
  const counts = g.invoices.counts || {};
  return (
    <div className="adm-stack">
      {card}
      <div className="card">
        <div className="cardhead">
          <h3>Networks</h3>
          <button className="swap" style={SM} disabled={busy} onClick={load}>Refresh</button>
        </div>
        {g.networks.map((n) => {
          const s = g.scanners.find((x) => x.network === n.network);
          const lag = s ? Number(s.tip) - Number(s.height) : 0;
          const stale = s && !n.paused && n.open > 0 ? s.age_s > 300 || lag > 150 : false;
          return (
            <div className="row adm-m" key={n.network}>
              <div>
                {NET[n.network] || n.network}
                <small>{n.assets.map((a) => a.toUpperCase()).join(', ')} · {n.confirmations} conf</small>
                {n.address && <small className="serial" style={{ wordBreak: 'break-all' }}>{n.address}</small>}
              </div>
              <div style={{ textAlign: 'right' }}>
                <b style={stale ? WARN : undefined}>{!n.configured ? 'Off' : n.paused ? 'Paused' : n.open === 0 ? 'Idle' : s ? (stale ? 'Behind' : 'Scanning') : 'Polling'}</b>
                {n.configured && s && !n.paused && n.open > 0 && <small>Block {s.height} · {agoText(s.age_s)}{lag > 0 ? ` · ${lag} behind` : ''}</small>}
                {n.configured && !n.paused && <small>{n.open > 0 ? `${n.open} open invoice${n.open === 1 ? '' : 's'}` : 'No open invoices'}</small>}
                {n.configured && (
                  <button className="swap" style={{ ...SM, marginTop: 6 }} disabled={busy || lock || (!n.paused && n.open > 0)} onClick={() => toggle(n)}>
                    {n.paused ? 'Resume' : 'Pause'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Fold title="Invoices" sub={`${(counts.pending || 0) + (counts.confirming || 0) + (counts.partial || 0)} open · ${counts.paid || 0} paid`}>
        {Object.keys(INV).map((k) => (
          <div className="row" key={k}><span className="mute">{INV[k]}</span><b>{counts[k] || 0}</b></div>
        ))}
        <span className="eyebrow adm-sub">Latest</span>
        {g.invoices.recent.length === 0 && <p className="empty" style={{ paddingTop: 8 }}>None yet.</p>}
        {g.invoices.recent.map((i) => (
          <div className="row adm-m" key={i.id}>
            <div>
              {String(i.asset).toUpperCase()} on {NET[i.network] || i.network}{i.usd === null ? '' : ` · $${i.usd}`}
              <small>{trimAmount(i.expected) || '?'} expected{i.received && Number(i.received) > 0 ? ` · ${trimAmount(i.received)} paid` : ''} · {when(i.created_at)}</small>
              <small className="serial">{shortId(i.ref)}</small>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div><Pill tone={i.status === 'paid' ? 'ok' : i.status === 'confirming' || i.status === 'partial' ? 'warn' : i.status === 'failed' ? 'bad' : ''}>{INV[i.status] || i.status}</Pill></div>
              {i.kind === 'order' && i.status === 'pending' && (
                <button className="swap" style={{ ...SM, marginTop: 6 }} disabled={busy || lock} onClick={() => closeInv(i)}>Close</button>
              )}
            </div>
          </div>
        ))}
      </Fold>

      <Fold title="Unmatched payments" sub={g.unmatched.total ? `${g.unmatched.total} to return` : 'None'} start={g.unmatched.total > 0}>
        <p className="fine" style={{ margin: '0 0 4px' }}>Money that reached a shared address with no invoice for that exact amount. Return it by hand, then tap Handled.</p>
        {g.unmatched.recent.length === 0 && <p className="empty" style={{ paddingTop: 8 }}>None.</p>}
        {g.unmatched.recent.map((u) => (
          <div className="row adm-m" key={`${u.network}-${u.txid}-${u.vout}`}>
            <div>
              {u.amount === null ? '?' : trimAmount(u.amount)} {String(u.asset).toUpperCase()}
              <small>{NET[u.network] || u.network} · {when(u.seen_at)}</small>
              <small className="serial" style={{ wordBreak: 'break-all', userSelect: 'all' }}>{u.txid}</small>
            </div>
            <button className="swap" style={SM} disabled={busy} onClick={() => handle(u)}>Handled</button>
          </div>
        ))}
      </Fold>

      <Fold title="Callbacks to the app" sub={`${g.callbacks.pending} waiting · ${g.callbacks.failing} failing`} start={g.callbacks.failing > 0}>
        <div className="row"><span className="mute">Waiting to send</span><b>{g.callbacks.pending}</b></div>
        <div className="row"><span className="mute">Failing</span><b style={g.callbacks.failing > 0 ? WARN : undefined}>{g.callbacks.failing}</b></div>
        {g.callbacks.stuck.map((c) => (
          <div className="row adm-m" key={`${c.ref}-${c.event}`}>
            <div>
              {c.event} · {c.attempts} tries
              <small className="serial">{shortId(c.ref)}</small>
              {c.last_error && <small>{c.last_error}</small>}
            </div>
          </div>
        ))}
      </Fold>

      <Fold title="Recent activity" sub={`${g.audit.length} entr${g.audit.length === 1 ? 'y' : 'ies'}`}>
        {g.audit.length === 0 && <p className="empty" style={{ paddingTop: 8 }}>Nothing yet.</p>}
        {g.audit.map((a, i) => (
          <div className="row adm-m" key={`${a.at}-${i}`}>
            <div>{a.action}<small>{a.actor}{a.subject ? ` · ${shortId(a.subject)}` : ''}</small></div>
            <span className="mute">{when(a.at)}</span>
          </div>
        ))}
      </Fold>
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
  const [edit, setEdit] = useState(null); // { kind: 'hall', id, draft }
  const [setup, setSetup] = useState(false); // first run: no admin account yet
  const [refDraft, setRefDraft] = useState(null); // referral settings being edited, as strings
  const [tf, setTf] = useState({ code: '', th: '15' }); // test friend form
  const [pw, setPw] = useState({ cur: '', next: '' }); // admin password form
  const [adj, setAdj] = useState(ADJ0); // balance change form (one user at a time)
  const [uq, setUq] = useState(''); // user search text
  const [openU, setOpenU] = useState(null); // the user card that is open
  const [flt, setFlt] = useState('open'); // Open / All filter on Orders and Withdrawals
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

  // The payment gateway, read once the screen is ready: the Gateway tab badge and the Overview alert come from it.
  // Overview stays hidden for up to 1.5 s while the first answer is on its way, so nothing shifts when it arrives.
  const [gw, setGw] = useState(null);
  const [gwWait, setGwWait] = useState(true);
  const loadGw = useCallback(async () => {
    try {
      setGw(await call('GET', '/api/admin/gateway'));
    } catch {
      setGw({ ok: false, error: 'No connection. Try again.' });
    }
  }, []);
  const isReady = state === 'ready';
  useEffect(() => {
    if (!isReady) return undefined;
    const t = setTimeout(() => setGwWait(false), 1500);
    loadGw().finally(() => setGwWait(false));
    return () => clearTimeout(t);
  }, [isReady, loadGw]);

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
  // Gateway items that need a person: unmatched payments to return and callbacks that keep failing.
  const gwUn = gw?.ok ? gw.unmatched.total : 0;
  const gwFail = gw?.ok ? gw.callbacks.failing : 0;
  const gwN = gwUn + gwFail;
  const gwText = [gwUn > 0 && `${gwUn} unmatched payment${gwUn === 1 ? '' : 's'}`, gwFail > 0 && `${gwFail} failing callback${gwFail === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
  // Miners per ASIC hall (Smart Mining miners have no hall of their own).
  const hallStat = {};
  users.forEach((u) => u.miners.forEach((m) => {
    if (!m.hall) return;
    const s = (hallStat[m.hall] = hallStat[m.hall] || { n: 0, on: 0 });
    s.n += 1;
    if (m.online) s.on += 1;
  }));
  const hallLine = (id) => (hallStat[id] ? `${hallStat[id].on}/${hallStat[id].n} miners online` : 'No miners');
  const needle = uq.trim().toLowerCase();
  const shownUsers = needle ? users.filter((u) => String(u.id).toLowerCase().includes(needle)) : users;
  const orderOpen = (o) => o.status === 'review' || o.status === 'pending';
  const wdOpen = (w) => w.status === 'pending' || w.status === 'approved';
  const openFirst = (isOpen) => (a, b) => Number(isOpen(b)) - Number(isOpen(a));
  const shownOrders = flt === 'open' ? orders.filter(orderOpen) : [...orders].sort(openFirst(orderOpen));
  const shownWds = flt === 'open' ? withdrawals.filter(wdOpen) : [...withdrawals].sort(openFirst(wdOpen));
  const setDraft = (k, v) => setEdit((e) => ({ ...e, draft: { ...e.draft, [k]: v } }));

  const hallDraft = (h) => !h ? { name: '', place: '', power: '', efficiency: '', rig: '', net: '' } : ({ name: h.name, place: h.place, power: h.power, efficiency: h.efficiency, rig: h.rig, net: String(h.net) });

  async function saveHall() {
    const ok = await run(
      { action: 'hall-save', id: edit.id === 'new' ? undefined : edit.id, hall: edit.draft },
      (r) => (r.updated ? `Hall saved · ${r.updated} miner${r.updated === 1 ? '' : 's'} updated` : 'Hall saved')
    );
    if (ok) setEdit(null);
  }

  const smartHallDraft = (h) => ({ name: h.name, place: h.place, power: h.power, rig: h.rig, efficiency: h.efficiency || '' });

  async function saveSmartHall() {
    if (await run({ action: 'smart-hall-save', id: edit.id, hall: edit.draft }, 'Smart hall saved')) setEdit(null);
  }

  return (
    <>
      <div className="top">
        <h2>Admin</h2>
        <button className="swap" style={SM} onClick={signOut}>Sign out</button>
      </div>

      <Tabs
        value={tab}
        onPick={(k) => {
          setTab(k);
          window.scrollTo({ top: 0 });
        }}
        items={[['overview', 'Overview'], ['users', 'Users'], ['orders', 'Orders', stats.ordersReview], ['withdrawals', 'Withdrawals', stats.withdrawalsOpen], ['halls', 'Halls'], ['smart', 'Smart'], ['referrals', 'Referrals'], ['send', 'Send'], ['gateway', 'Gateway', gwN], ['settings', 'Settings']]}
      />

      {tab === 'settings' && (
        <div className="adm-stack">
          <Fold title="Hashrate and uptime charts" sub={charts.mock ? 'Mock data' : 'Real data'}>
            <div className="row"><span className="mute">Showing</span><b>{charts.mock ? 'Mock data' : 'Real data'}</b></div>
            <div className="row">
              <span className="mute">Hall feed</span>
              <b>{!charts.feed.enabled ? 'Off (no TELEMETRY_KEY)' : charts.feed.samples ? `${charts.feed.miners} miner${charts.feed.miners === 1 ? '' : 's'} · last ${when(charts.feed.last)}` : 'Nothing received yet'}</b>
            </div>
            <div className="adm-actions">
              <button
                className="btn"
                disabled={busy}
                onClick={async () => {
                  const toReal = charts.mock;
                  if (toReal && !charts.feed.samples && !(await ask('No samples have come in from the halls yet, so the charts will say "No data yet". Switch anyway?', { ok: 'Switch' }))) return;
                  run({ action: 'charts-mock', mode: toReal ? 'real' : 'mock' }, toReal ? 'Charts now show real data' : 'Charts now show mock data');
                }}
              >
                {charts.mock ? 'Switch to real data' : 'Switch to mock data'}
              </button>
            </div>
            <p className="fine" style={{ margin: '8px 0 0' }}>Mock is made-up numbers. Real is what the halls report to /api/telemetry; with none, the charts say no data. Applies to every user at once.</p>
          </Fold>
          <FirstBonusCard fb={data.firstBonus} busy={busy} run={run} />
          <BoostCard bs={data.boost} busy={busy} run={run} />
          <GuardCard guard={data.guard} busy={busy} run={run} />
          <Fold title="Demo account" sub="Wipe to a clean slate">
            <p className="fine" style={{ margin: '0 0 8px' }}>Wipes the demo account back to a clean slate: miners, activity, balance changes, withdrawals, payment orders and the invite test friends made under it. Real accounts are not touched.</p>
            <div className="adm-actions">
              <button
                className="btn"
                disabled={busy}
                onClick={async () => {
                  if (!(await ask('Wipe the demo account? Its miners, activity, balance and test friends are deleted. This cannot be undone.', { ok: 'Wipe', danger: true }))) return;
                  run({ action: 'demo-reset' }, (r) => `Demo account cleaned · ${r.miners} miner${r.miners === 1 ? '' : 's'} removed`);
                }}
              >
                Clean up demo account
              </button>
            </div>
          </Fold>
          <Fold title="Admin password" sub="Change the sign-in password">
            <Field id="pwc" label="Current password" type="password" autoComplete="current-password" value={pw.cur} onChange={(v) => setPw((p) => ({ ...p, cur: v }))} />
            <Field id="pwn" label="New password (10+ characters)" type="password" autoComplete="new-password" value={pw.next} onChange={(v) => setPw((p) => ({ ...p, next: v }))} />
            <div className="adm-actions">
              <button className="btn" disabled={busy || !pw.cur || pw.next.length < 10} onClick={async () => (await run({ action: 'admin-password', current: pw.cur, next: pw.next }, 'Password changed')) && setPw({ cur: '', next: '' })}>Change password</button>
            </div>
            <p className="fine" style={{ margin: '8px 0 0' }}>Other signed-in browsers are signed out.</p>
          </Fold>
        </div>
      )}

      {tab === 'overview' && (
        <div className="adm-stack" style={gwWait ? { visibility: 'hidden' } : undefined}>
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
              <b>{stats.withdrawalsOpen} withdrawal{stats.withdrawalsOpen === 1 ? '' : 's'} to handle</b>
              <span className="mute">Open ›</span>
            </button>
          )}
          {stats.ordersReview > 0 && (
            <button className="card adm-alert" onClick={() => setTab('orders')}>
              <b>{stats.ordersReview} order{stats.ordersReview === 1 ? '' : 's'} need a check</b>
              <span className="mute">Open ›</span>
            </button>
          )}
          {gwN > 0 && (
            <button className="card adm-alert" onClick={() => setTab('gateway')}>
              <b>{gwText}</b>
              <span className="mute">Open ›</span>
            </button>
          )}
          <div className="card">
            <h3>System</h3>
            <div className="row"><span className="mute">Storage</span><b>{mode}</b></div>
            <div className="row"><span className="mute">BTC fallback price</span><b>${btcUsd.toLocaleString()}</b></div>
            <div className="row"><span className="mute">Latest miner ID</span><b className="serial">{formatSerial(serial)}</b></div>
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
          <div className="field" style={{ marginTop: 0 }}>
            <input id="usq" type="search" autoComplete="off" autoCapitalize="none" spellCheck="false" placeholder=" " value={uq} onChange={(e) => setUq(e.target.value)} />
            <label htmlFor="usq">Search users</label>
          </div>
          {shownUsers.length === 0 && <p className="empty" style={{ textAlign: 'center' }}>No user matches.</p>}
          {shownUsers.map((u) => (
            <div className="card adm-fold" data-open={openU === u.id} key={u.id}>
              <button type="button" className="adm-fh" aria-expanded={openU === u.id} onClick={() => setOpenU(openU === u.id ? null : u.id)}>
                <span>
                  <span className="adm-ft">{u.id}</span>
                  <small>{u.available.toFixed(8)} BTC · {u.miners.length} miner{u.miners.length === 1 ? '' : 's'}</small>
                </span>
                <Pill tone={u.kyc.status === 'verified' ? 'ok' : u.kyc.status === 'pending' ? 'warn' : ''}>{KYC[u.kyc.status] || u.kyc.status}</Pill>
                <i aria-hidden="true" />
              </button>
              {openU === u.id && (
              <div className="adm-fb">
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
                        if (!(await ask(`${adj.op === 'add' ? 'Add' : 'Take'} ${adj.amount.trim()} ${adj.cur === 'usd' ? `USD (about ${adjBtc(adj, rate?.btc).toFixed(8)} BTC)` : 'BTC'} ${adj.op === 'add' ? 'to' : 'from'} ${u.id}?`, { ok: 'Apply' }))) return;
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
                    <button className="btn ghost danger" disabled={busy} onClick={() => ask(`Reject verification for ${u.id}?`, { ok: 'Reject', danger: true }).then((yes) => yes && run({ action: 'kyc', userId: u.id, decision: 'reject' }, 'Rejected'))}>Reject</button>
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
                    onClick={() => ask(`Remove all ${u.miners.length} miner${u.miners.length === 1 ? '' : 's'} from ${u.id}? This cannot be undone.`, { ok: 'Remove all', danger: true }).then((yes) => yes && run({ action: 'miners-clear', userId: u.id }, (r) => `${r.removed} removed`))}
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
                    <button className="btn ghost" disabled={busy} onClick={() => ask(`Refund ${m.serial}? The miner is removed and its price goes back to the balance. Only allowed within 24 hours, before the first payout day.`, { ok: 'Refund' }).then((yes) => yes && run({ action: 'miner', userId: u.id, serial: m.serial, op: 'refund' }, (r) => `Refunded ${r.btc.toFixed(8)} BTC ($${r.usd.toFixed(2)})`))}>
                      Refund
                    </button>
                    <button className="btn ghost danger" disabled={busy} onClick={() => ask(`Remove ${m.serial}? This cannot be undone.`, { ok: 'Remove', danger: true }).then((yes) => yes && run({ action: 'miner', userId: u.id, serial: m.serial, op: 'delete' }, 'Miner removed'))}>
                      Remove
                    </button>
                  </div>
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
              <div className="row"><span className="mute">User</span><b>{o.userId}</b></div>
              <div className="row"><span className="mute">Created</span><b>{when(o.at)}</b></div>
              {o.paidAt && <div className="row"><span className="mute">Paid</span><b>{when(o.paidAt)}</b></div>}
              {o.serial && <div className="row"><span className="mute">Miner</span><b className="serial">{o.serial}</b></div>}
              {o.invoiceId && <div className="row"><span className="mute">Invoice</span><b className="serial">{o.invoiceId}</b></div>}
              {(o.status === 'review' || o.status === 'pending') && (
                <div className="adm-actions">
                  <button className="btn ghost danger" disabled={busy} onClick={() => ask(`Close this order for ${o.userId}?`, { ok: 'Close', danger: true }).then((yes) => yes && run({ action: 'order', userId: o.userId, orderId: o.id, decision: 'reject' }, 'Order closed'))}>Close</button>
                  <button className="btn" disabled={busy} onClick={() => ask(`Start the miner for ${o.userId}? Only do this once you have checked the payment with the payment provider (or on the blockchain).`, { ok: 'Start miner' }).then((yes) => yes && run({ action: 'order', userId: o.userId, orderId: o.id, decision: 'approve' }, (r) => `Miner ${r.serial} started`))}>Start miner</button>
                </div>
              )}
            </Fold>
          ))}
        </div>
      )}

      {tab === 'withdrawals' && (
        <div className="adm-stack">
          <Filter value={flt} onPick={setFlt} open={withdrawals.filter(wdOpen).length} all={withdrawals.length} />
          {shownWds.length === 0 && <p className="empty" style={{ textAlign: 'center' }}>{withdrawals.length === 0 ? 'No withdrawals yet.' : 'Nothing open.'}</p>}
          {shownWds.map((w) => {
            const act = (decision, okText, txid) => run({ action: 'withdrawal', userId: w.userId, withdrawalId: w.id, decision, txid }, okText);
            const open = w.status === 'pending' || w.status === 'approved';
            return (
              <Fold key={w.id} title={`${w.amount} ${String(w.asset).toUpperCase()}`} sub={`${w.userId} · ${when(w.at)}`} start={open} pill={<Pill tone={w.status === 'sent' ? 'ok' : open ? 'warn' : 'bad'}>{WD[w.status] || w.status}</Pill>}>
                <div className="row"><span className="mute">User</span><b>{w.userId}</b></div>
                <div className="row"><span className="mute">Network</span><b>{String(w.net).toUpperCase()}</b></div>
                <div className="row"><span className="mute">Pay out</span><b>{w.receive} {String(w.asset).toUpperCase()}</b></div>
                <div className="row"><span className="mute">Address</span><b className="serial" style={{ wordBreak: 'break-all', userSelect: 'all', textAlign: 'right' }}>{w.address}</b></div>
                <div className="row"><span className="mute">Asked</span><b>{when(w.at)}</b></div>
                {w.txid && <div className="row"><span className="mute">Transaction</span><b className="serial" style={{ wordBreak: 'break-all', textAlign: 'right' }}>{w.txid}</b></div>}
                {w.status === 'pending' && (
                  <div className="adm-actions">
                    <button className="btn ghost danger" disabled={busy} onClick={() => ask(`Reject this withdrawal for ${w.userId}? The amount goes back to their balance.`, { ok: 'Reject', danger: true }).then((yes) => yes && act('reject', 'Rejected and refunded'))}>Reject</button>
                    <button className="btn" disabled={busy} onClick={() => ask(`Approve ${w.amount} ${String(w.asset).toUpperCase()} to ${w.address}?`, { ok: 'Approve' }).then((yes) => yes && act('approve', 'Approved'))}>Approve</button>
                  </div>
                )}
                {w.status === 'approved' && (
                  <div className="adm-actions">
                    <button className="btn ghost danger" disabled={busy} onClick={() => ask(`Mark as failed? The amount goes back to ${w.userId}'s balance.`, { ok: 'Mark failed', danger: true }).then((yes) => yes && act('fail', 'Marked failed and refunded'))}>Failed</button>
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={async () => {
                        const txid = await askText('Mark this withdrawal as sent?', { label: 'Transaction id of your payout', ok: 'Mark sent', required: true });
                        if (txid) act('sent', 'Marked as sent', txid);
                      }}
                    >
                      Mark sent
                    </button>
                  </div>
                )}
              </Fold>
            );
          })}
        </div>
      )}

      {tab === 'halls' && (
        <div className="adm-stack">
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
                      if ((await ask(`Delete ${h.name}? This only works when no miner uses it.`, { ok: 'Delete', danger: true })) && (await run({ action: 'hall-delete', id }, 'Hall deleted'))) setEdit(null);
                    }}
                  />
                </div>
              ) : (
                <button key={id} type="button" className="row adm-click" aria-label={`Edit ${h.name}`} onClick={() => setEdit({ kind: 'hall', id, draft: hallDraft(h) })}>
                  <div>
                    {h.name}
                    <small>{h.rig} · {h.efficiency} · {h.place}</small>
                    <small>{hallLine(id)}</small>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <b>${h.net}</b>
                    <small>per TH/day</small>
                  </div>
                </button>
              )
            )}
          </div>

          <div className="card">
            <div className="cardhead">
              <h3>Smart Mining halls</h3>
            </div>
            {Object.entries(data.smart?.halls || {}).map(([id, h]) =>
              edit?.kind === 'smart-hall' && edit.id === id ? (
                <div key={id} className="adm-edit">
                  <SmartHallForm draft={edit.draft} set={setDraft} busy={busy} asic={h.kind === 'asic'} onSave={saveSmartHall} onCancel={() => setEdit(null)} />
                </div>
              ) : (
                <button key={id} type="button" className="row adm-click" aria-label={`Edit ${h.name}`} onClick={() => setEdit({ kind: 'smart-hall', id, draft: smartHallDraft(h) })}>
                  <div>
                    {h.name}
                    <small>{h.rig} · {h.place}</small>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <b>{SMART_KIND[h.kind] || h.kind}</b>
                  </div>
                </button>
              )
            )}
            <p className="fine" style={{ margin: '8px 0 12px' }}>Smart Mining miners run on these halls: the ASIC hall for BTC, the GPU hall for KAS, RVN and ETC, the CPU hall for XMR. Hall details are shown to users on the miner page.</p>
            <button
              className="btn ghost"
              disabled={busy}
              onClick={async () => {
                if ((await ask('Reset the Smart Mining halls to the built-in details?', { ok: 'Reset' })) && (await run({ action: 'smart-halls-reset' }, 'Smart halls reset'))) setEdit(null);
              }}
            >
              Reset Smart halls
            </button>
          </div>

          <button
            className="btn ghost danger"
            disabled={busy}
            onClick={async () => {
              if ((await ask('Reset the halls to the built-in defaults? Hall rates of existing miners follow the defaults again.', { ok: 'Reset', danger: true })) && (await run({ action: 'catalog-reset' }, 'Reset to defaults'))) setEdit(null);
            }}
          >
            Reset to defaults
          </button>
        </div>
      )}

      {tab === 'smart' && (
        <div className="adm-stack">
          <SmartCard smart={data.smart} busy={busy} run={run} />
        </div>
      )}

      {tab === 'referrals' && (() => {
        const R = data.referrals;
        const d = refDraft || Object.fromEntries(Object.entries(R.settings).map(([k, v]) => [k, String(v)]));
        const put = (k, v) => setRefDraft({ ...d, [k]: v });
        const code = tf.code || R.codes[0]?.code || '';
        const th = tf.th ?? '15';
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
              <p className="fine" style={{ margin: '0 0 4px' }}>Creates a test friend who signs up with the code and gets an ASICs miner (90 days).</p>
              <Pick id="tfc" label="Inviter code" value={code} onChange={(v) => setTf({ ...tf, code: v })}>
                {R.codes.map((c) => <option key={c.code} value={c.code}>{c.id} · {c.code}</option>)}
              </Pick>
              <Field id="tfp" label="Hash power (TH/s)" inputMode="decimal" value={th} onChange={(v) => setTf({ ...tf, th: v })} />
              <div style={{ height: 12 }} />
              <button className="btn" disabled={busy || !code} onClick={() => run({ action: 'ref-test', code, th: Number(String(th).replace(',', '.')), days: 90 }, (r) => `Created ${r.friend}`)}>Create test friend</button>
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

      {tab === 'gateway' && <GatewayTab pp={data.payProvider} run={run} lock={busy} g={gw} reload={loadGw} />}

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
      <AskHost />
      {toast}
    </>
  );
}
