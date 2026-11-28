// What it costs to run the machines. One place, so the plan sheet, the Terms page and the FAQ agree.
// Electricity and maintenance are not billed to anyone: they come out of what the machines mine before the daily payout
// (see the note above `halls` in lib/data.js). Electricity per TH/s per day = J/TH x 24 h / 1000 x $/kWh.

// USD per TH/s per day. The same share the hall net rates in lib/data.js are built on.
export const MAINT_PER_TH_DAY = 0.002;

// USD gross per TH/s per day (hashprice, late Sep 2026). net = gross - electricity - maintenance, see lib/data.js.
export const GROSS_PER_TH_DAY = 0.0398;

const read = (text, re) => {
  const m = re.exec(String(text ?? ''));
  return m ? Number(m[1]) : null;
};

// Per TH/s per day, read from the hall's own efficiency ('15.0 J/TH') and power price ('... $0.05/kWh') so halls the
// admin adds or edits are covered too. Null when a hall does not state both, so nothing wrong is ever shown.
export function hallRates(hall) {
  const jth = read(hall?.efficiency, /([\d.]+)\s*J\/TH/i);
  const kwh = read(hall?.power, /\$([\d.]+)\s*\/kWh/i);
  if (!(jth > 0) || !(kwh > 0)) return null;
  return { elec: ((jth * 24) / 1000) * kwh, maint: MAINT_PER_TH_DAY };
}

// The rates a hall is paid at on the UTC day that starts at `day`. hall.rateLog = [{ from, elec, maint }], oldest first, is written
// when an admin changes a hall's rates, so a finished day keeps the rates it had. No log = the rates never changed.
export function ratesOn(hall, day) {
  const log = hall?.rateLog;
  if (!log?.length) return hallRates(hall);
  let r = log[0];
  for (const e of log) if (e.from <= day) r = e;
  return { elec: r.elec, maint: r.maint };
}

// The rate history `next` (a hall as it is being saved) carries on from `prev` (the hall as it was). New rates start at `from`
// (the next 00:00 UTC) and replace any change still waiting to start. Undefined = no history is needed.
export function rateLogFor(prev, next, from) {
  const was = hallRates(prev);
  const now = hallRates(next);
  if (!prev?.rateLog && (!was || (now && was.elec === now.elec && was.maint === now.maint))) return undefined;
  const kept = (prev.rateLog || [{ from: 0, ...was }]).filter((e) => e.from < from);
  const last = kept[kept.length - 1];
  if (!now || (last.elec === now.elec && last.maint === now.maint)) return kept.length > 1 ? kept : undefined;
  return [...kept, { from, ...now }];
}

// USD per day for `th` TH/s in `hall`, or null.
export function dailyCosts(th, hall) {
  const r = hallRates(hall);
  return r && th > 0 ? { elec: r.elec * th, maint: r.maint * th } : null;
}

// Small amounts need a third decimal to say anything.
export const fmtCost = (n) => (n < 0.1 ? n.toFixed(3) : n.toFixed(2));
