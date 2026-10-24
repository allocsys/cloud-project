// First-buy bonus settings the admin can change. They live in the meta entry "firstbonus"
// { enabled, pct, capTh, capUsd, minUsd, until }; a change reaches every server within a few seconds (the meta cache).
// What the numbers mean and how the bonus is worked out: lib/first-bonus.js. It only applies to purchases made after saving and
// is fixed on each miner when it starts.
import { warm, metaGet, metaUpdate } from '@/lib/server/db';
import { normalizeFirstBonus, FIRST_BONUS_MAX } from '@/lib/first-bonus';

const fail = (status, error) => ({ ok: false, status, error });

export async function firstBonusSettings() {
  await warm();
  return normalizeFirstBonus(metaGet('firstbonus'));
}

const num = (v) => (v === null || v === undefined || String(v).trim() === '' ? NaN : Number(String(v).trim().replace(',', '.')));

const FIELDS = [
  ['pct', 'Bonus percent', 0.1, FIRST_BONUS_MAX.pct],
  ['capTh', 'Max bonus TH/s', 0.01, FIRST_BONUS_MAX.capTh],
  ['capUsd', 'Max bonus budget (USD)', 0.01, FIRST_BONUS_MAX.capUsd],
  ['minUsd', 'Min purchase (USD)', 0, FIRST_BONUS_MAX.minUsd],
];

// Saves what is given and leaves the rest as it is, so the switch can be flipped on its own. `until` is a date (YYYY-MM-DD, the bonus
// stays on through the end of that UTC day) or empty for no end date.
export async function saveFirstBonusSettings(input) {
  const patch = {};
  if (input?.enabled !== undefined) patch.enabled = input.enabled === true || input.enabled === 'true';
  for (const [key, label, min, max] of FIELDS) {
    if (input?.[key] === undefined) continue;
    const v = num(input[key]);
    if (!(v >= min && v <= max)) return fail(422, `${label} must be between ${min} and ${max}.`);
    patch[key] = Math.round(v * 100) / 100;
  }
  if (input?.until !== undefined) {
    const s = String(input.until ?? '').trim();
    if (!s) patch.until = null;
    else {
      const t = /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(`${s}T23:59:59.999Z`) : NaN;
      if (!Number.isFinite(t)) return fail(422, 'End date must look like 2026-12-31.');
      patch.until = t;
    }
  }
  const saved = await metaUpdate('firstbonus', (cur) => {
    const value = normalizeFirstBonus({ ...(cur || {}), ...patch });
    return { value, result: value };
  });
  return { ok: true, status: 200, settings: saved };
}
