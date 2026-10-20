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

// USD per day for `th` TH/s in `hall`, or null.
export function dailyCosts(th, hall) {
  const r = hallRates(hall);
  return r && th > 0 ? { elec: r.elec * th, maint: r.maint * th } : null;
}

// Small amounts need a third decimal to say anything.
export const fmtCost = (n) => (n < 0.1 ? n.toFixed(3) : n.toFixed(2));
