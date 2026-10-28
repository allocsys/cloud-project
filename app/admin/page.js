'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fmtTh, fmtUsd } from '@/lib/data';
import { formatSerial } from '@/lib/contracts';
import { useToast } from '@/components/Toast';
import { SMART_BUDGETS, SMART_TABLE } from '@/lib/smart';
import { smartHallFor } from '@/lib/smart-halls';
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
  ['firstPct', 'First purchase %'],
  ['dailyPct', 'Daily payouts %'],
  ['dailyDays', 'Reward days'],
  ['capPct', 'Cap %'],
  ['refereeTh', 'Gift TH/s'],
  ['refereeDays', 'Gift days'],
  ['refereeMinUsd', 'Min buy $'],
  ['monthlyLimit', 'Friends/month'],
  ['maxRebate', 'Max rebate %'],
  ['maxCodes', 'Codes/user'],
  ['ticketCap', 'Tickets/inviter'],
];

// Smart Mining: sell on/off, the pay table for new purchases (ten rates by budget on a 90 day term, plus what 120, 150 and 180 days add;
// shown in percent, stored as fractions), and which coins may be picked. See lib/server/smart-admin.js.
const pctText = (p) => String(Math.round(p * 1e6) / 1e4);
const draftOf = (t) => ({ rates: t.rates.map(pctText), b120: pctText(t.bonus[120]), b150: pctText(t.bonus[150]), b180: pctText(t.bonus[180]) });
function SmartCard({ smart, busy, run }) {
  const set = smart?.settings || { enabled: true, table: SMART_TABLE };
  const table = set.table || SMART_TABLE;
  const coins = smart?.coins || [];
  const days = smart?.days || [];
  const cost = smart?.cost;
  const anchor = days[0]?.anchor ?? coins.find((c) => c.ref !== null)?.ref;
  const key = JSON.stringify(table);
  const [d, setD] = useState(() => draftOf(table));
  useEffect(() => setD(draftOf(JSON.parse(key))), [key]);
  const floorNow = set.anchorFloorNext ?? set.anchorFloor ?? 1;
  const [fl, setFl] = useState(String(floorNow));
  useEffect(() => setFl(String(floorNow)), [floorNow]);
  const asFraction = (v) => Number(String(v).trim().replace(',', '.')) / 100;
  const save = () => run({ action: 'smart-settings', enabled: set.enabled, rates: d.rates.map(asFraction), bonus: { 120: asFraction(d.b120), 150: asFraction(d.b150), 180: asFraction(d.b180) } }, 'Smart Mining pay table saved');
  return (
    <Fold title="Smart Mining" sub={set.enabled ? 'Selling' : 'Off'} start>
      <div className="row"><span className="mute">Selling</span><b>{set.enabled ? 'On' : 'Off'}</b></div>
      <Fold title="Pay table" sub="Net profit a day by budget">
      <span className="eyebrow adm-sub">Net profit a day at the reference market, 90 days (%)</span>
      <div className="adm-3col">
      {SMART_BUDGETS.map((b, i) => (
        <Field key={b} id={`smr${i}`} label={`$${b.toLocaleString('en-US')}`} inputMode="decimal" value={d.rates[i]} onChange={(v) => setD({ ...d, rates: d.rates.map((x, j) => (j === i ? v : x)) })} />
      ))}
      </div>
      <span className="eyebrow adm-sub">Added a day on longer terms (%)</span>
      <div className="adm-3col">
      <Field id="smb1" label="120 days" inputMode="decimal" value={d.b120} onChange={(v) => setD({ ...d, b120: v })} />
      <Field id="smb2" label="150 days" inputMode="decimal" value={d.b150} onChange={(v) => setD({ ...d, b150: v })} />
      <Field id="smb3" label="180 days" inputMode="decimal" value={d.b180} onChange={(v) => setD({ ...d, b180: v })} />
      </div>
      </Fold>
      <div className="adm-actions">
        <button className="btn" disabled={busy} onClick={save}>Save pay table</button>
        <button className="btn" disabled={busy} onClick={() => run({ action: 'smart-settings', enabled: !set.enabled }, set.enabled ? 'Smart Mining is off' : 'Smart Mining is on')}>
          {set.enabled ? 'Turn off' : 'Turn on'}
        </button>
      </div>
      <How><p className="fine">Between two budgets the rate follows the log of the budget, and it stays flat above $10,000. Each rate must be between 0.1% and 1%. Off hides Smart Mining and refuses new purchases; miners already running keep paying. A new table applies to purchases made after saving, each miner keeps the rate and reserve band it was bought with.</p></How>
      <span className="eyebrow adm-sub">Coins and their reference rig</span>
      <div className="row"><span className="mute">Electricity price</span><b>{cost?.inUse ? `$${cost.inUse} per kWh (live)` : cost?.auto === false ? 'Each coin\'s own (live price off)' : 'Each coin\'s own (no live price)'}</b></div>
      {cost?.live && <How><p className="fine">Eurostat industrial price for {cost.live.period}, average of Iceland and Norway, €{cost.live.eur} per kWh, at the ECB rate of {cost.live.rate} on {cost.live.rateDate} (Frankfurter). Eurostat updates twice a year. If the feed is down or older than 30 days, each coin's own price below is used.</p></How>}
      <div className="adm-actions">
        <button className="btn ghost" disabled={busy} onClick={() => run({ action: 'smart-settings', enabled: set.enabled, kwhAuto: !(set.kwhAuto !== false) }, set.kwhAuto !== false ? 'Live electricity price is off' : 'Live electricity price is on')}>
          {set.kwhAuto !== false ? 'Use each coin\'s own price' : 'Use the live price'}
        </button>
      </div>
      <How><p className="fine">A coin's daily net profit = gross for the rig minus the rig's power cost, in USD. Every coin is measured against one anchor{anchor > 0 ? ` (${usd2(anchor)} a day now)` : ''}: the average of the best coin over the last 30 finished days, never below the floor ({usd2(set.anchorFloor ?? 1)} now). The rig figures are editable defaults, and a change only applies to new readings.</p></How>
      <Field id="smfl" label="Anchor floor (USD a day)" inputMode="decimal" value={fl} onChange={setFl} />
      <div className="adm-actions">
        <button className="btn" disabled={busy} onClick={() => run({ action: 'smart-settings', enabled: set.enabled, anchorFloor: fl }, 'Anchor floor saved')}>Save floor</button>
      </div>
      <p className="fine" style={{ margin: '0 0 8px' }}>Between $0.10 and $10. A new floor starts tomorrow (UTC). Days already decided or paid keep the floor they had.{set.anchorFloorNext !== undefined && set.anchorFloorNext !== set.anchorFloor ? ` Tomorrow: ${usd2(set.anchorFloorNext)}.` : ''}</p>
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
                <span key={c.symbol} style={{ marginRight: 10, fontWeight: (r.pick || r.best) === c.symbol ? 700 : 400 }}>{c.symbol} {r.nets[c.symbol] === undefined || r.nets[c.symbol] === null ? 'n/a' : `${usd2(r.nets[c.symbol])} ×${(r.anchor ?? anchor) > 0 ? Math.max(0, r.nets[c.symbol] / (r.anchor ?? anchor)).toFixed(2) : '?'}`}</span>
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
          <div className="adm-3col">
          <Field id={`rh${c.symbol}`} label={`Hash ${c.unit}`} inputMode="decimal" value={f.rigHash} onChange={(v) => setF({ ...f, rigHash: v })} />
          <Field id={`rw${c.symbol}`} label="Watts" inputMode="decimal" value={f.rigWatts} onChange={(v) => setF({ ...f, rigWatts: v })} />
          <Field id={`rk${c.symbol}`} label="$ per kWh" inputMode="decimal" value={f.kwh} onChange={(v) => setF({ ...f, kwh: v })} />
          </div>
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
  const d = draft || { asicsAuto: s.asicsAuto, smartAuto: s.smartAuto, mode: s.mode, margin: String(s.margin), buffer: String(s.buffer), smartFloor: String(s.smartFloor ?? 0.5) };
  const put = (k, v) => setDraft({ ...d, [k]: v });
  const lastText = (t) => (t ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : 'never');
  const daysText = (list) => (list && list.length ? list.map(lastText).join(', ') : 'none');
  return (
    <Fold start title="Profit guard" sub={(guard.scopes || []).some((sc) => sc.pausedToday) ? `${(guard.scopes || []).filter((sc) => sc.pausedToday).length} paused today` : 'All running'}>
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
      <div className="adm-2col">
      <Field id="gpg" label="ASIC margin %" inputMode="decimal" value={d.margin} onChange={(v) => put('margin', v)} />
      <Field id="gpb" label="Resume buffer %" inputMode="decimal" value={d.buffer} onChange={(v) => put('buffer', v)} />
      </div>
      <p className="fine" style={{ margin: '8px 0 0' }}>Margin: profit needed to count an ASIC day (0 = break even).</p>
      <Field id="gpf" label="Smart pause floor (0 = never)" inputMode="decimal" value={d.smartFloor} onChange={(v) => put('smartFloor', v)} />
      <How><p className="fine">Once paused, a hall resumes only when its profit share is back above margin plus buffer. Smart Mining pauses for a day when the best coin's ratio is under the floor (1 = the anchor day, 0.5 = half of it) and resumes only above the floor plus the buffer as ratio points (2% = 0.02); it is the same for every plan, and days decided before this rule keep the old break-even rule. The paused-day setting applies to miners bought after saving; each miner keeps the one it was bought with. Changes apply to days not yet decided.</p></How>
      <div className="adm-actions">
        <button className="btn ghost" disabled={busy} onClick={() => run({ action: 'guard-backtest', asicsAuto: d.asicsAuto, smartAuto: d.smartAuto, margin: d.margin, buffer: d.buffer, smartFloor: d.smartFloor }, (r) => { setTest(r); return 'Tested the last 30 days'; })}>Test last 30 days</button>
        <button className="btn" disabled={busy || !draft} onClick={async () => { if (await run({ action: 'guard-settings', ...d }, 'Profit guard saved')) setDraft(null); }}>Save</button>
      </div>
      {test && (
        <div style={{ marginTop: 8 }}>
          <p className="fine" style={{ margin: '0 0 4px' }}>Last {test.days} days ({test.withData} with market data), margin {test.margin}%, buffer {test.buffer}% and Smart floor {test.smartFloor}. The rule only; hand flips are not counted. Nothing was saved.</p>
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
      <div className="adm-2col">
      <Field id="fbp" label="Bonus %" inputMode="decimal" value={d.pct} onChange={(v) => setD({ ...d, pct: v })} />
      <Field id="fbm" label="Min buy $" inputMode="decimal" value={d.minUsd} onChange={(v) => setD({ ...d, minUsd: v })} />
      <Field id="fbt" label="Max ASIC TH/s" inputMode="decimal" value={d.capTh} onChange={(v) => setD({ ...d, capTh: v })} />
      <Field id="fbu" label="Max Smart $" inputMode="decimal" value={d.capUsd} onChange={(v) => setD({ ...d, capUsd: v })} />
      </div>
      <Field id="fbe" label="Last day (empty = no end)" value={d.until} onChange={(v) => setD({ ...d, until: v })} />
      <p className="fine" style={{ margin: '8px 0 0' }}>Bonus % is of the purchase. Max Smart $ is in USD of budget. Last day is UTC, like 2026-12-31.</p>
      <div className="adm-actions">
        <button className="btn" disabled={busy} onClick={() => run({ action: 'firstbonus-settings', ...d }, 'First-buy bonus saved')}>Save</button>
        <button className="btn" disabled={busy} onClick={() => run({ action: 'firstbonus-settings', enabled: !s.enabled }, s.enabled ? 'First-buy bonus is off' : 'First-buy bonus is on')}>
          {s.enabled ? 'Turn off' : 'Turn on'}
        </button>
      </div>
      <How><p className="fine">A user's first purchase paid with crypto gets extra hashrate for the whole term. ASICs get extra TH/s (the percent of the size, up to the TH/s cap). Smart Mining gets a higher profit rate by the same percent, up to the USD cap measured on the budget; the budget that comes back does not change. A first purchase paid from the balance gets nothing and uses up the chance. Not for renewals or admin grants. It applies to purchases made after saving, each miner keeps the bonus it started with.</p></How>
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
              <b style={m !== null && m < 0 ? { color: 'var(--red)' } : undefined}>{m === null ? '—' : `Margin ${marginText(m)}`}</b>
            </div>
            <div className="adm-2col">
            <Field id={`bc${t.id}`} label="Real chance %" inputMode="decimal" value={d.chance[t.id]} onChange={(v) => type('chance', t.id, v)} />
            <Field id={`bs${t.id}`} label="Shown chance %" inputMode="decimal" value={d.shown[t.id]} onChange={(v) => type('shown', t.id, v)} />
            </div>
            {m !== null && m < 0 && <p className="fine" style={{ margin: '4px 0 0', color: 'var(--red)' }}>At this chance the ${t.price} ticket loses money (each one costs more than it brings in).</p>}
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
      <How><p className="fine">Each purchase is its own boost of {BOOST.hours} hours with its own draw, made at purchase and shown when the boost ends. The boost pay (flat ${BOOST.rate} per TH/s per day) and any prize go to the balance at the end. Margin = 1 - (boost pay + real chance x prize) / price, so it moves with the real chance and is not typed. The real chance decides the draw; the shown chance is what users see on the cards (empty = the real one). A new chance applies to tickets bought after saving; a running boost keeps the chances it was bought with. Off hides the tickets and refuses new purchases; running boosts still finish and pay.</p></How>
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

// A closed 'How it works' line for the long explanations under a form, so the buttons stay in view.
function How({ children }) {
  return (
    <details className="adm-how">
      <summary>How it works</summary>
      {children}
    </details>
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
      <div className="adm-2col">
      <Field id="he" label="Efficiency J/TH" value={draft.efficiency} onChange={(v) => set('efficiency', v)} maxLength={20} />
      <Field id="hr" label="Rig model" value={draft.rig} onChange={(v) => set('rig', v)} maxLength={40} />
      </div>
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
// A Smart hall's power text names a price like "$0.04/kWh". When the price Smart uses for its coins is another, say so (the text itself is never changed).
const hallKwhNote = (id, h, smart) => {
  const m = /\$\s*(\d+(?:[.,]\d+)?)\s*\/\s*kWh/i.exec(h.power || '');
  if (!m) return null;
  const label = Number(m[1].replace(',', '.'));
  const live = smart?.cost?.inUse > 0 ? smart.cost.inUse : null;
  const prices = new Set();
  for (const c of smart?.coins || []) {
    if (!c.enabled || smartHallFor(c.symbol)?.id !== id) continue;
    const p = live ?? c.kwh;
    if (p > 0) prices.add(p.toFixed(2));
  }
  const diff = [...prices].filter((p) => Math.abs(Number(p) - label) >= 0.005);
  return diff.length ? `Label says $${label.toFixed(2)}/kWh, Smart uses $${diff.join(' / $')}/kWh` : null;
};

// One Smart Mining hall. Its kind and the coins it mines are fixed; only the details shown to users can change.
function SmartHallForm({ draft, set, busy, asic, onSave, onCancel }) {
  return (
    <div className="adm-form">
      <Field id="shn" label="Name" value={draft.name} onChange={(v) => set('name', v)} maxLength={40} />
      <Field id="shp" label="Location" value={draft.place} onChange={(v) => set('place', v)} maxLength={40} />
      <Field id="shw" label="Power source" value={draft.power} onChange={(v) => set('power', v)} maxLength={60} />
      <div className="adm-2col">
      {asic && <Field id="she" label="Efficiency J/TH" value={draft.efficiency} onChange={(v) => set('efficiency', v)} maxLength={20} />}
      <Field id="shr" label="Rig" value={draft.rig} onChange={(v) => set('rig', v)} maxLength={40} />
      </div>
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
// Five groups on the top row; the open group's sections show on a second row. Badges add up inside a group.
const GROUPS = [
  ['home', 'Overview', ['overview']],
  ['people', 'People', ['users', 'referrals', 'boosts', 'send']],
  ['money', 'Money', ['orders', 'withdrawals', 'gateway']],
  ['mining', 'Mining', ['halls', 'smart', 'guard']],
  ['system', 'System', ['database', 'settings']],
];
function Tabs({ items, value, onPick }) {
  const box = useRef(null);
  const [menu, setMenu] = useState(false); // the five groups stay hidden until the menu button is tapped
  const info = Object.fromEntries(items.map(([k, l, n]) => [k, [l, n || 0]]));
  const group = GROUPS.find((g) => g[2].includes(value)) || GROUPS[0];
  const count = (g) => g[2].reduce((s, k) => s + (info[k]?.[1] || 0), 0);
  const total = GROUPS.reduce((s, g) => s + count(g), 0);
  useEffect(() => {
    box.current?.querySelectorAll('.adm-tabs').forEach((b) => {
      const el = b.querySelector('[aria-pressed=true]');
      if (el) b.scrollTo({ left: el.offsetLeft - (b.clientWidth - el.offsetWidth) / 2, behavior: 'smooth' });
    });
  }, [value]);
  return (
    <div className="adm-nav" role="navigation" aria-label="Admin sections" ref={box}>
      <div className="adm-menu">
        <button type="button" className="adm-menu-btn" aria-expanded={menu} aria-haspopup="true" onClick={() => setMenu((v) => !v)}>
          <span>{group[1]}</span>
          {!menu && total > 0 && <b>{total}</b>}
          <i aria-hidden="true" />
        </button>
      </div>
      {menu && (
        <div className="adm-tabs" role="group" aria-label="Groups">
          {GROUPS.map((g) => (
            <button
              key={g[0]}
              aria-pressed={group[0] === g[0]}
              onClick={() => {
                setMenu(false);
                if (group[0] !== g[0]) onPick(g[2][0]);
              }}
            >
              {g[1]}
              {count(g) > 0 && <b>{count(g)}</b>}
            </button>
          ))}
        </div>
      )}
      {group[2].length > 1 && (
        <div className="adm-tabs adm-sub-tabs" role="group" aria-label={group[1]}>
          {group[2].map((k) => (
            <button key={k} aria-pressed={value === k} onClick={() => onPick(k)}>
              {info[k]?.[0] || k}
              {info[k]?.[1] > 0 && <b>{info[k][1]}</b>}
            </button>
          ))}
        </div>
      )}
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
const NET = { btc: 'Bitcoin', eth: 'Ethereum', bsc: 'BNB Chain', pol: 'Polygon', trx: 'Tron', sol: 'Solana', ton: 'TON' };
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

// Database tab: a read-only look at the app's own Postgres (lib/server/db-admin.js). Nothing here changes data; JSON and secret-looking columns are not shown in full.
const bytesText = (n) => (n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const secsText = (s) => (s < 90 ? `${s}s` : `${Math.round(s / 60)} min`);

function DatabaseTab() {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null); // the table whose rows are shown
  const [rows, setRows] = useState(null);
  const load = useCallback(async () => {
    setBusy(true);
    try {
      setD(await call('GET', '/api/admin/database'));
    } catch {
      setD({ ok: false, error: 'No connection. Try again.' });
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const pickTable = async (name) => {
    if (open === name) {
      setOpen(null);
      setRows(null);
      return;
    }
    setOpen(name);
    setRows(null);
    try {
      setRows(await call('GET', `/api/admin/database?table=${encodeURIComponent(name)}`));
    } catch {
      setRows({ ok: false, error: 'No connection. Try again.' });
    }
  };
  if (!d) return <p className="empty" style={{ textAlign: 'center' }}>Loading…</p>;
  if (!d.ok) {
    return (
      <div className="adm-stack">
        <div className="card">
          <h3>Database</h3>
          <p className="fine" style={{ margin: '0 0 12px' }}>{d.error || 'Could not load.'}</p>
          <button className="btn" disabled={busy} onClick={load}>Retry</button>
        </div>
      </div>
    );
  }
  const m = d.migrations;
  const connWarn = d.connections.max > 0 && d.connections.total / d.connections.max > 0.8;
  return (
    <div className="adm-stack">
      <div className="card">
        <div className="cardhead">
          <h3>Database</h3>
          <button className="swap" style={SM} disabled={busy} onClick={load}>Refresh</button>
        </div>
        <div className="row"><span className="mute">Status</span><Pill tone={d.ping > 500 ? 'warn' : 'ok'}>Connected · {d.ping} ms</Pill></div>
        <div className="row"><span className="mute">Server</span><b>{d.version}</b></div>
        <div className="row"><span className="mute">Size</span><b>{bytesText(d.bytes)}</b></div>
        <div className="row"><span className="mute">Connections</span><b style={connWarn ? WARN : undefined}>{d.connections.total} of {d.connections.max} · {d.connections.active} busy</b></div>
        <div className="row"><span className="mute">This server's pool</span><b style={d.pool.waiting > 0 ? WARN : undefined}>{d.pool.total} open · {d.pool.idle} idle · {d.pool.waiting} waiting</b></div>
        <div className="row"><span className="mute">Migrations</span><b style={m.pending.length ? WARN : undefined}>{m.pending.length ? `${m.pending.length} not applied` : `${m.applied} applied`}</b></div>
      </div>

      <Fold title="Tables" sub={`${d.tables.length} tables`} start>
        {d.tables.map((t) => (
          <div key={t.name}>
            <button type="button" className="row adm-click" aria-expanded={open === t.name} onClick={() => pickTable(t.name)}>
              <div>
                {t.name}
                <small>{t.approx ? '~' : ''}{t.rows.toLocaleString('en-US')} row{t.rows === 1 ? '' : 's'} · {bytesText(t.bytes)}</small>
              </div>
              <span className="mute">{open === t.name ? 'Close' : 'Rows ›'}</span>
            </button>
            {open === t.name && (
              <div className="adm-form">
                {!rows && <p className="fine" style={{ margin: 0 }}>Loading…</p>}
                {rows && !rows.ok && <p className="fine" style={{ margin: 0 }}>{rows.error || 'Could not load.'}</p>}
                {rows?.ok && (
                  <>
                    <p className="fine" style={{ margin: '0 0 4px' }}>{rows.rows.length === 0 ? 'Empty.' : `Newest ${rows.rows.length} of ${rows.total.toLocaleString('en-US')}${rows.newest ? ` (by ${rows.newest})` : ''}. JSON shows its keys and size only.`}</p>
                    {rows.rows.map((r, i) => (
                      <div className="row adm-m" key={i}>
                        <div>
                          {rows.columns.map((k) => (
                            <small key={k} className="serial" style={{ wordBreak: 'break-all' }}>{k}: {r[k] === null || r[k] === undefined ? '—' : String(r[k])}</small>
                          ))}
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </Fold>

      <Fold title="Running now" sub={d.running.length ? `${d.running.length} busy` : 'Nothing busy'}>
        {d.running.length === 0 && <p className="empty" style={{ paddingTop: 8 }}>No query is running.</p>}
        {d.running.map((r, i) => (
          <div className="row adm-m" key={i}>
            <div>
              {r.state}
              <small className="serial" style={{ wordBreak: 'break-all' }}>{r.query}</small>
            </div>
            <b style={r.secs > 30 ? WARN : undefined}>{secsText(r.secs)}</b>
          </div>
        ))}
      </Fold>

      <Fold title="Migrations" sub={m.pending.length ? `${m.pending.length} not applied` : `${m.applied} of ${m.total} applied`} start={m.pending.length > 0}>
        {m.pending.map((id) => (
          <div className="row adm-m" key={id}><div>{id}<small>Not applied yet</small></div><Pill tone="warn">Waiting</Pill></div>
        ))}
        {m.list.map((x) => (
          <div className="row adm-m" key={x.id}><div>{x.id}</div><span className="mute">{when(x.at)}</span></div>
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
  const [toq, setToq] = useState(''); // search text for the recipient on the Send tab
  const [title, setTitle] = useState('');
  const [msg, setMsg] = useState('');
  const [edit, setEdit] = useState(null); // { kind: 'hall', id, draft }
  const [setup, setSetup] = useState(false); // first run: no admin account yet
  const [refDraft, setRefDraft] = useState(null); // referral settings being edited, as strings
  const [tf, setTf] = useState({ code: '', th: '15' }); // test friend form
  const [pw, setPw] = useState({ cur: '', next: '' }); // admin password form
  const [adj, setAdj] = useState(ADJ0); // balance change form (one user at a time)
  const [uq, setUq] = useState(''); // user search text
  const [usort, setUsort] = useState('new'); // user list order
  const [ufil, setUfil] = useState('all'); // user list filter
  const [uhist, setUhist] = useState(null); // user whose activity rows are open
  const [unote, setUnote] = useState({ id: null, text: '' }); // private note being edited (one user at a time)
  const [upw, setUpw] = useState({ id: null, text: '' }); // new password being typed (one user at a time)
  const [uinv, setUinv] = useState({ id: null, text: '' }); // inviter being set (one user at a time)
  const [umsg, setUmsg] = useState({ id: null, title: '', body: '' }); // message to one user being written
  const [ugift, setUgift] = useState({ id: null, kind: 'miner', th: '5', days: '30', count: '1' }); // gift being set up
  const [usm, setUsm] = useState(false); // select mode on the user list
  const [usel, setUsel] = useState([]); // ids picked in select mode
  const [bmsg, setBmsg] = useState(null); // bulk message form: null or { title, body }
  const [btk, setBtk] = useState(null); // bulk tickets form: null or the count as text
  // Downloads the users now shown (search and filter apply) as a CSV file. Text cells that start with = + - @ get a leading quote so a spreadsheet never runs them.
  const exportUsers = () => {
    const cell = (v) => {
      let s = v == null ? '' : String(v);
      if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const iso = (t) => (t ? new Date(t).toISOString() : '');
    const head = ['id', 'telegram', 'joined', 'last sign-in', 'available BTC', 'deposited BTC', 'earned BTC', 'withdrawn BTC', 'miners', 'KYC', 'blocked', 'withdrawals paused', 'invited by', 'friends invited', 'flags'];
    const rows = shownUsers.map((u) => [u.id, u.tg || '', iso(u.joined), iso(u.lastIn), u.available.toFixed(8), u.deposited.toFixed(8), u.earned.toFixed(8), u.withdrawn.toFixed(8), u.miners.length, u.kyc.status, u.blocked ? iso(u.blocked) : '', u.frozen ? iso(u.frozen) : '', u.refBy || '', u.invited, u.flags.join('; ')]);
    const blob = new Blob([[head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `users-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
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

  // One change for every picked user (select mode). The server goes through them one by one and says how many were refused.
  async function bulk(extra) {
    const ok = await run({ action: 'bulk', ids: usel, ...extra }, (x) => `${x.done} done${x.failed ? ` · ${x.failed} refused${x.errors?.[0] ? ` (${x.errors[0]})` : ''}` : ''}`);
    if (ok) {
      setBmsg(null);
      setBtk(null);
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
  const toNeedle = toq.trim().toLowerCase();
  const toList = users.filter((u) => !toNeedle || u.id === to || `${u.id} ${u.tg ? `@${u.tg}` : ''}`.toLowerCase().includes(toNeedle)).slice(0, 50);
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
  const found = needle ? users.filter((u) => `${u.id} ${u.tg ? `@${u.tg}` : ''}`.toLowerCase().includes(needle)) : users;
  const kycRank = (u) => (u.kyc.status === 'pending' ? 2 : u.kyc.status === 'verified' ? 1 : 0);
  const USORT = { new: (a, b) => (b.joined || 0) - (a.joined || 0), bal: (a, b) => b.available - a.available, miners: (a, b) => b.miners.length - a.miners.length, seen: (a, b) => (b.lastIn || 0) - (a.lastIn || 0), kyc: (a, b) => kycRank(b) - kycRank(a) };
  const UFIL = { all: () => true, blocked: (u) => !!u.blocked, frozen: (u) => !!u.frozen, unver: (u) => u.kyc.status !== 'verified', wd: (u) => u.withdrawalsOpen > 0, flag: (u) => u.flags.length > 0 };
  const shownUsers = [...found].filter(UFIL[ufil] || UFIL.all).sort(USORT[usort] || USORT.new);
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
        items={[['overview', 'Overview'], ['users', 'Users'], ['orders', 'Orders', stats.ordersReview], ['withdrawals', 'Withdrawals', stats.withdrawalsOpen], ['boosts', 'Boosts', (data.boosts || []).length], ['halls', 'Halls'], ['smart', 'Smart'], ['guard', 'Guard'], ['referrals', 'Referrals'], ['send', 'Send'], ['gateway', 'Gateway', gwN], ['database', 'Database'], ['settings', 'Settings']]}
      />

      {tab === 'boosts' && (
        <div className="adm-stack">
          {(data.boosts || []).length === 0 && <p className="empty" style={{ textAlign: 'center' }}>No boosts running.</p>}
          {(() => {
            const byUser = new Map();
            for (const b of data.boosts || []) {
              if (!byUser.has(b.userId)) byUser.set(b.userId, []);
              byUser.get(b.userId).push(b);
            }
            const groups = [...byUser.entries()].sort((a, c) => c[1].length - a[1].length);
            return groups.map(([userId, list]) => {
              const wins = list.filter((b) => b.win).length;
              return (
                <Fold key={userId} title={userId} sub={`${list.length} ${list.length === 1 ? 'boost' : 'boosts'}${wins ? ` · ${wins} ${wins === 1 ? 'win' : 'wins'}` : ''}`} start={groups.length === 1}>
                  {list.map((b) => (
                    <div key={b.id} style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
                      <div className="row">
                        <div>
                          <small>${b.price}{b.gift ? ' (free)' : ''} · {b.th.toLocaleString('en-US')} TH/s · ends {when(b.endsAt)} · chance {b.chance}%</small>
                        </div>
                        <b>{b.win ? (b.forced ? 'Win set' : 'Wins') : 'No win'}</b>
                      </div>
                      {!b.win && (
                        <div className="adm-actions">
                          <button className="btn" disabled={busy} onClick={() => run({ action: 'boost-win', userId: b.userId, id: b.id }, 'Boost will win')}>Make it win</button>
                        </div>
                      )}
                    </div>
                  ))}
                </Fold>
              );
            });
          })()}
        </div>
      )}

      {tab === 'guard' && (
        <div className="adm-stack">
          <GuardCard guard={data.guard} busy={busy} run={run} />
        </div>
      )}

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
          <div className="minitabs adm-filter" role="group" aria-label="Filter users">
            {[['all', 'All'], ['blocked', 'Blocked'], ['frozen', 'Paused'], ['unver', 'Unverified'], ['wd', 'Withdrawals'], ['flag', 'Flagged']].map(([k, t]) => (
              <button key={k} aria-pressed={ufil === k} onClick={() => setUfil(k)}>{t}</button>
            ))}
          </div>
          <div className="minitabs adm-filter" role="group" aria-label="Sort users">
            {[['new', 'New'], ['bal', 'Balance'], ['miners', 'Miners'], ['seen', 'Seen'], ['kyc', 'KYC']].map(([k, t]) => (
              <button key={k} aria-pressed={usort === k} onClick={() => setUsort(k)}>{t}</button>
            ))}
          </div>
          {shownUsers.length > 0 && (
            <div className="adm-tool">
              <span className="mute">{shownUsers.length} user{shownUsers.length === 1 ? '' : 's'}</span>
              <div className="adm-btns">
                <button className="swap" style={SM} onClick={exportUsers}>Export CSV</button>
                <button className="swap" style={SM} onClick={() => { setUsm((v) => !v); setUsel([]); setBmsg(null); setBtk(null); }}>{usm ? 'Done' : 'Select'}</button>
              </div>
            </div>
          )}
          {usm && (
            <div className="card adm-form">
              <div className="row"><span className="mute">Picked</span><b>{usel.length} of {shownUsers.length}</b></div>
              <div className="adm-actions" style={{ flexWrap: 'wrap' }}>
                <button className="swap" style={SM} onClick={() => setUsel(shownUsers.map((x) => x.id))}>All shown</button>
                <button className="swap" style={SM} onClick={() => setUsel([])}>None</button>
              </div>
              <div className="adm-actions" style={{ flexWrap: 'wrap' }}>
                {[['block', 'Block', true], ['unblock', 'Unblock', false], ['freeze', 'Pause withdrawals', true], ['unfreeze', 'Allow withdrawals', false]].map(([op, t, danger]) => (
                  <button key={op} className={`swap${danger ? ' danger' : ''}`} style={SM} disabled={busy || !usel.length} onClick={async () => { if (await ask(`${t} for ${usel.length} user${usel.length === 1 ? '' : 's'}?`, { ok: t, danger })) bulk({ op }); }}>{t}</button>
                ))}
                <button className="swap" style={SM} disabled={busy || !usel.length} onClick={() => { setBtk(null); setBmsg({ title: '', body: '' }); }}>Message</button>
                <button className="swap" style={SM} disabled={busy || !usel.length} onClick={() => { setBmsg(null); setBtk('1'); }}>Tickets</button>
              </div>
              {bmsg && (
                <div className="adm-form">
                  <Field id="bmt" label="Title" maxLength={80} value={bmsg.title} onChange={(v) => setBmsg({ ...bmsg, title: v })} />
                  <Field id="bmb" label="Message" maxLength={240} value={bmsg.body} onChange={(v) => setBmsg({ ...bmsg, body: v })} />
                  <div className="adm-actions">
                    <button className="btn ghost" onClick={() => setBmsg(null)}>Cancel</button>
                    <button className="btn" disabled={busy || !usel.length || !bmsg.title.trim()} onClick={async () => { if (await ask(`Send this message to ${usel.length} user${usel.length === 1 ? '' : 's'}?`, { ok: 'Send' })) bulk({ op: 'notify', title: bmsg.title, body: bmsg.body }); }}>Send</button>
                  </div>
                </div>
              )}
              {btk !== null && (
                <div className="adm-form">
                  <Field id="btc" label="Tickets each (1 to 10)" inputMode="numeric" value={btk} onChange={setBtk} />
                  <div className="adm-actions">
                    <button className="btn ghost" onClick={() => setBtk(null)}>Cancel</button>
                    <button className="btn" disabled={busy || !usel.length} onClick={async () => { if (await ask(`Give ${btk} free boost ticket${btk === '1' ? '' : 's'} to each of ${usel.length} user${usel.length === 1 ? '' : 's'}?`, { ok: 'Give' })) bulk({ op: 'tickets', count: btk }); }}>Give</button>
                  </div>
                </div>
              )}
            </div>
          )}
          {shownUsers.length === 0 && <p className="empty" style={{ textAlign: 'center' }}>No user matches.</p>}
          {shownUsers.map((u) => (
            <div className="card adm-fold" data-open={openU === u.id && !usm} key={u.id} style={usm && usel.includes(u.id) ? { outline: '2px solid var(--gold)' } : undefined}>
              <button type="button" className="adm-fh" aria-expanded={openU === u.id} onClick={() => (usm ? setUsel((s) => (s.includes(u.id) ? s.filter((x) => x !== u.id) : [...s, u.id])) : setOpenU(openU === u.id ? null : u.id))}>
                <span>
                  <span className="adm-ft">{u.tg ? `@${u.tg}` : u.id}</span>
                  <small>{u.available.toFixed(8)} BTC · {u.miners.length} miner{u.miners.length === 1 ? '' : 's'}{u.blocked ? ' · blocked' : ''}{u.frozen ? ' · withdrawals paused' : ''}{u.flags.length ? ' · flagged' : ''}{usm && usel.includes(u.id) ? ' · picked' : ''}</small>
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
              {adj.id === u.id ? (
                <div className="adm-form">
                  <div className="adm-2col">
                  <Pick id="ajo" label="Change" value={adj.op} onChange={(v) => setAdj({ ...adj, op: v })}>
                    <option value="add">Add</option>
                    <option value="subtract">Take</option>
                  </Pick>
                  <Pick id="ajc" label="Amount in" value={adj.cur} onChange={(v) => setAdj({ ...adj, cur: v, amount: '' })}>
                    <option value="btc">BTC</option>
                    <option value="usd">USD</option>
                  </Pick>
                  </div>
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
                <div className="adm-grid two">
                  <button className="swap" style={SM} disabled={busy} onClick={() => setAdj({ ...ADJ0, id: u.id })}>Change balance</button>
                  {u.id !== 'demo' && <button className="swap" style={SM} onClick={() => setUhist(uhist === u.id ? null : u.id)}>{uhist === u.id ? 'Hide history' : `Show history · ${u.history.length}`}</button>}
                </div>
              )}

              {u.id !== 'demo' && (
                <>
                  {uhist === u.id && u.history.length === 0 && <p className="empty" style={{ paddingTop: 8 }}>Nothing yet.</p>}
                  {uhist === u.id && u.history.map((h, i) => (
                    <div className="row adm-m" key={`${h.at}-${i}`}>
                      <div>{h.label || h.kind}<small>{when(h.at) || h.date}{h.status ? ` · ${h.status}` : ''}</small></div>
                      <b>{h.amount ? `${h.amount} ${h.coin}` : ''}</b>
                    </div>
                  ))}
                  {umsg.id === u.id && (
                    <div className="adm-form">
                      <Field id="umt" label="Title" maxLength={80} value={umsg.title} onChange={(v) => setUmsg({ ...umsg, title: v })} />
                      <Field id="umb" label="Message" maxLength={240} value={umsg.body} onChange={(v) => setUmsg({ ...umsg, body: v })} />
                      <div className="adm-actions">
                        <button className="btn ghost" onClick={() => setUmsg({ id: null, title: '', body: '' })}>Cancel</button>
                        <button className="btn" disabled={busy || !umsg.title.trim()} onClick={async () => { if (await run({ action: 'notify', userId: u.id, title: umsg.title, body: umsg.body }, 'Sent')) setUmsg({ id: null, title: '', body: '' }); }}>Send</button>
                      </div>
                    </div>
                  )}
                  {ugift.id === u.id && (
                    <div className="adm-form">
                      <Pick id="ugk" label="Gift" value={ugift.kind} onChange={(v) => setUgift({ ...ugift, kind: v })}>
                        <option value="miner">Free miner</option>
                        <option value="tickets">Free boost tickets</option>
                      </Pick>
                      {ugift.kind === 'miner' ? (
                        <>
                          <div className="adm-2col">
                          <Field id="ugt" label="Power (TH/s)" inputMode="decimal" value={ugift.th} onChange={(v) => setUgift({ ...ugift, th: v })} />
                          <Field id="ugd" label="Days" inputMode="numeric" value={ugift.days} onChange={(v) => setUgift({ ...ugift, days: v })} />
                          </div>
                        </>
                      ) : (
                        <Field id="ugc" label="Tickets (1 to 10)" inputMode="numeric" value={ugift.count} onChange={(v) => setUgift({ ...ugift, count: v })} />
                      )}
                      <div className="adm-actions">
                        <button className="btn ghost" onClick={() => setUgift({ ...ugift, id: null })}>Cancel</button>
                        <button
                          className="btn"
                          disabled={busy}
                          onClick={async () => {
                            const what = ugift.kind === 'miner' ? `a ${ugift.th} TH/s miner for ${ugift.days} days` : `${ugift.count} free boost ticket${ugift.count === '1' ? '' : 's'}`;
                            if (!(await ask(`Give ${what} to ${u.id}?`, { ok: 'Give' }))) return;
                            if (await run({ action: 'gift', userId: u.id, kind: ugift.kind, th: ugift.th, days: ugift.days, count: ugift.count }, (r) => (r.serial ? `Gift sent · ${r.serial}` : 'Gift sent'))) setUgift({ ...ugift, id: null });
                          }}
                        >
                          Give
                        </button>
                      </div>
                    </div>
                  )}
                  {upw.id === u.id && (
                    <div className="adm-form">
                      <Field id="upw" label="New password (8+ characters)" autoComplete="off" maxLength={200} value={upw.text} onChange={(v) => setUpw({ ...upw, text: v })} />
                      <p className="fine" style={{ margin: '4px 0 0' }}>The user is signed out everywhere. Tell them the new password yourself.</p>
                      <div className="adm-actions">
                        <button className="btn ghost" onClick={() => setUpw({ id: null, text: '' })}>Cancel</button>
                        <button
                          className="btn"
                          disabled={busy || upw.text.length < 8}
                          onClick={async () => {
                            if (!(await ask(`Set a new password for ${u.id}?`, { ok: 'Set', danger: true }))) return;
                            if (await run({ action: 'user', userId: u.id, op: 'set-password', password: upw.text }, 'Password set')) setUpw({ id: null, text: '' });
                          }}
                        >
                          Set
                        </button>
                      </div>
                    </div>
                  )}
                  {uinv.id === u.id && (
                    <div className="adm-form">
                      <Field id="uinv" label="Inviter (email, id or invite code)" autoComplete="off" maxLength={120} value={uinv.text} onChange={(v) => setUinv({ ...uinv, text: v })} />
                      <p className="fine" style={{ margin: '4px 0 0' }}>Rewards follow the new inviter from now on.</p>
                      <div className="adm-actions">
                        <button className="btn ghost" onClick={() => setUinv({ id: null, text: '' })}>Cancel</button>
                        <button
                          className="btn"
                          disabled={busy || !uinv.text.trim()}
                          onClick={async () => {
                            if (!(await ask(`Set the inviter of ${u.id} to ${uinv.text.trim()}?`, { ok: 'Set' }))) return;
                            if (await run({ action: 'user', userId: u.id, op: 'ref-set', inviter: uinv.text }, 'Inviter set')) setUinv({ id: null, text: '' });
                          }}
                        >
                          Set
                        </button>
                      </div>
                    </div>
                  )}
                  {unote.id === u.id ? (
                    <div className="adm-form">
                      <Field id="unt" label="Private note (admin only)" maxLength={200} value={unote.text} onChange={(v) => setUnote({ ...unote, text: v })} />
                      <div className="adm-actions">
                        <button className="btn ghost" onClick={() => setUnote({ id: null, text: '' })}>Cancel</button>
                        <button className="btn" disabled={busy} onClick={async () => { if (await run({ action: 'user', userId: u.id, op: 'note', note: unote.text }, 'Note saved')) setUnote({ id: null, text: '' }); }}>Save</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {u.note && <p className="adm-note"><small>Note</small>{u.note}</p>}
                      <div className="adm-grid">
                        <button className="swap" style={SM} disabled={busy} onClick={() => ask(u.frozen ? `Allow withdrawals again for ${u.id}?` : `Pause withdrawals for ${u.id}? They can still sign in.`, { ok: u.frozen ? 'Allow' : 'Pause', danger: !u.frozen }).then((yes) => yes && run({ action: 'user', userId: u.id, op: u.frozen ? 'unfreeze' : 'freeze' }, u.frozen ? 'Withdrawals open' : 'Withdrawals paused'))}>{u.frozen ? 'Allow withdrawals' : 'Pause withdrawals'}</button>
                        <button className="swap" style={SM} disabled={busy} onClick={() => setUnote({ id: u.id, text: u.note || '' })}>{u.note ? 'Edit note' : 'Add note'}</button>
                        <button className="swap" style={SM} disabled={busy} onClick={() => setUmsg({ id: u.id, title: '', body: '' })}>Message</button>
                        {u.hasPw && <button className="swap" style={SM} disabled={busy} onClick={() => setUpw({ id: u.id, text: '' })}>Password</button>}
                        <button className="swap" style={SM} disabled={busy} onClick={() => setUinv({ id: u.id, text: '' })}>{u.refBy ? 'Change inviter' : 'Set inviter'}</button>
                        {u.refBy && <button className="swap" style={SM} disabled={busy} onClick={() => ask(`Remove the inviter of ${u.id}? Their rewards stop.`, { ok: 'Remove', danger: true }).then((yes) => yes && run({ action: 'user', userId: u.id, op: 'ref-clear' }, 'Inviter removed'))}>Remove inviter</button>}
                        <button className="swap" style={SM} disabled={busy} onClick={() => setUgift({ ...ugift, id: u.id })}>Gift</button>
                        <button className="swap" style={SM} disabled={busy} onClick={() => run({ action: 'user', userId: u.id, op: u.kyc.status === 'verified' ? 'unverify' : 'verify' }, u.kyc.status === 'verified' ? 'Verified removed' : 'Verified')}>{u.kyc.status === 'verified' ? 'Unverify' : 'Verify'}</button>
                        <button className="swap" style={SM} disabled={busy} onClick={() => ask(`Sign ${u.id} out everywhere?`, { ok: 'Sign out' }).then((yes) => yes && run({ action: 'user', userId: u.id, op: 'reset-sessions' }, 'Signed out'))}>Sign out</button>
                        {u.twofa && <button className="swap" style={SM} disabled={busy} onClick={() => ask(`Turn off two-factor for ${u.id}?`, { ok: 'Turn off', danger: true }).then((yes) => yes && run({ action: 'user', userId: u.id, op: 'reset-2fa' }, 'Two-factor off'))}>Reset 2FA</button>}
                        <button
                          className="swap danger"
                          style={SM}
                          disabled={busy}
                          onClick={async () => {
                            const t = await askText(`Delete ${u.id}? The account is closed for good: sign-in data and details are erased${u.miners.length ? `, and ${u.miners.length} miner${u.miners.length === 1 ? '' : 's'} end with no refund` : ''}. Orders, withdrawals and history stay in the books.`, { label: 'Type DELETE to confirm', ok: 'Delete', danger: true, required: true });
                            if (t == null || t === false) return;
                            if (String(t).trim().toUpperCase() !== 'DELETE') { show('Not deleted. Type DELETE.'); return; }
                            run({ action: 'user-close', userId: u.id, confirm: 'DELETE' }, 'Account closed');
                          }}
                        >
                          Delete account
                        </button>
                        <button className={`swap${u.blocked ? '' : ' danger'}`} style={SM} disabled={busy} onClick={() => ask(u.blocked ? `Unblock ${u.id}?` : `Block ${u.id}? They are signed out and cannot sign in.`, { ok: u.blocked ? 'Unblock' : 'Block', danger: !u.blocked }).then((yes) => yes && run({ action: 'user', userId: u.id, op: u.blocked ? 'unblock' : 'block' }, u.blocked ? 'Unblocked' : 'Blocked'))}>{u.blocked ? 'Unblock' : 'Block'}</button>
                      </div>
                    </>
                  )}
                </>
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
                <div className="adm-miner" key={m.serial}>
                  <div className="adm-mh">
                    <span className="adm-mn">{m.name}</span>
                    <b>${m.dailyUsd.toFixed(2)}<span>/day</span></b>
                  </div>
                  <small><span className="serial">{m.serial}</span> · Day {m.elapsed}/{m.days}{m.online ? '' : ' · offline'}</small>
                  <div className="adm-bar"><i style={{ width: `${Math.min(100, Math.max(0, (m.elapsed / (m.days || 1)) * 100))}%` }} /></div>
                  <div className="adm-grid">
                    <button className="swap" style={SM} disabled={busy} onClick={() => run({ action: 'miner', userId: u.id, serial: m.serial, op: m.online ? 'offline' : 'online' }, m.online ? 'Set offline' : 'Set online')}>
                      {m.online ? 'Offline' : 'Online'}
                    </button>
                    <button className="swap" style={SM} disabled={busy} onClick={() => ask(`Refund ${m.serial}? The miner is removed and its price goes back to the balance. Only allowed within 24 hours, before the first payout day.`, { ok: 'Refund' }).then((yes) => yes && run({ action: 'miner', userId: u.id, serial: m.serial, op: 'refund' }, (r) => `Refunded ${r.btc.toFixed(8)} BTC ($${r.usd.toFixed(2)})`))}>
                      Refund
                    </button>
                    <button className="swap danger" style={SM} disabled={busy} onClick={() => ask(`Remove ${m.serial}? This cannot be undone.`, { ok: 'Remove', danger: true }).then((yes) => yes && run({ action: 'miner', userId: u.id, serial: m.serial, op: 'delete' }, 'Miner removed'))}>
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
              {(o.paidAt || o.serial || o.invoiceId) && (
                <div className="adm-kv" style={{ borderTop: 0, marginTop: 4, paddingTop: 0 }}>
                  {o.paidAt && <div><small>Paid</small><b>{when(o.paidAt)}</b></div>}
                  {o.serial && <div><small>Miner</small><b className="serial">{o.serial}</b></div>}
                  {o.invoiceId && <div><small>Invoice</small><b className="serial">{o.invoiceId}</b></div>}
                </div>
              )}
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
                <div className="adm-tiles">
                  <div><small>Pay out</small><b>{w.receive}<span>{String(w.asset).toUpperCase()}</span></b></div>
                  <div><small>Network</small><b>{String(w.net).toUpperCase()}</b></div>
                </div>
                <div className="adm-addr"><small>Address</small><span className="serial">{w.address}</span></div>
                {w.txid && <div className="adm-addr"><small>Transaction</small><span className="serial">{w.txid}</span></div>}
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
                    <small>{hallLine(id)} · tap to edit</small>
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
                    <small>{h.rig} · {h.place} · tap to edit</small>
                    {hallKwhNote(id, h, data.smart) && <small style={WARN}>{hallKwhNote(id, h, data.smart)}</small>}

                  </div>
                </button>
              )
            )}
            <p className="fine" style={{ margin: '8px 0 12px' }}>Smart Mining miners run on these halls: the ASIC halls for BTC and KAS, the GPU hall for RVN and ETC, the CPU hall for XMR. Hall details are shown to users on the miner page.</p>
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
              <div className="adm-2col">
                {REF_FIELDS.map(([k, l]) => (
                  <Field key={k} id={`rf-${k}`} label={l} inputMode="decimal" value={d[k]} onChange={(v) => put(k, v)} />
                ))}
              </div>
              <p className="fine" style={{ margin: '12px 0 0' }}>
                Gift TH/s and Tickets/inviter: 0 = off. The referrer&apos;s total is capped at the cap share of what the friend spends, minus the cost of the friend&apos;s gift miner. Changes apply to rewards from now on.
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
              <h3>Free tickets · {(R.tickets || []).length}</h3>
              {(R.tickets || []).length === 0 && <p className="empty" style={{ paddingTop: 8 }}>No free tickets given to inviters yet.</p>}
              {(R.tickets || []).map((x) => (
                <div className="row" key={x.id}>
                  <span>{x.id}</span>
                  <b>{x.n} / {R.settings.ticketCap}</b>
                </div>
              ))}
            </div>

            <div className="card">
              <h3>Friends · {R.links.length}</h3>
              {R.links.length === 0 && <p className="empty" style={{ paddingTop: 8 }}>No invited friends yet.</p>}
              {R.links.map((l) => (
                <div className="row" key={l.friend}>
                  <div>
                    {l.friend}
                    <small>by {l.inviter} · spent ${fmtUsd(l.spendUsd)}{l.gift ? ' · gift given' : ''}{l.ticket ? ' · free ticket' : ''}{l.rebate > 0 ? ` · ${l.rebate}% rebate` : ''}</small>
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

      {tab === 'database' && <DatabaseTab />}

      {tab === 'send' && (
        <div className="card adm-stack">
          <h3>Send a notification</h3>
          <div className="field" style={{ marginTop: 4 }}>
            <input id="toq" type="search" autoComplete="off" autoCapitalize="none" spellCheck="false" placeholder=" " value={toq} onChange={(e) => setToq(e.target.value)} />
            <label htmlFor="toq">Find a user</label>
          </div>
          <div className="field" style={{ marginTop: 4 }}>
            <select id="to" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="all">All users</option>
              {toList.map((u) => <option key={u.id} value={u.id}>{u.tg ? `@${u.tg} · ${u.id}` : u.id}</option>)}
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
              if (to === 'all' && !(await ask(`Send this to all ${users.length} users? It cannot be undone.`, { ok: 'Send to all', danger: true }))) return;
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
