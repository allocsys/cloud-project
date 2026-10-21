// Tiers along the two plan sliders. A tier starts at `from` (TH/s for ASICs, dollars for Smart Mining) and lasts until the next one.
// The ASICs tiers match the six plans and the rig drawn for each size (see rigFor in components/RigArt.js).
import { SMART } from './smart.js';

export const ASIC_TIERS = [
  { id: 'starter', name: 'Starter', from: 1 },
  { id: 'basic', name: 'Basic', from: 30 },
  { id: 'growth', name: 'Growth', from: 100 },
  { id: 'plus', name: 'Plus', from: 250 },
  { id: 'pro', name: 'Pro', from: 500 },
  { id: 'elite', name: 'Elite', from: 1000 },
];

export const SMART_TIERS = [
  { id: 'spark', name: 'Spark', from: 50 },
  { id: 'flow', name: 'Flow', from: 500 },
  { id: 'surge', name: 'Surge', from: 2000 },
  { id: 'nova', name: 'Nova', from: 5000 },
];

// The tier a value falls in (the first tier below its start).
export function tierOf(tiers, value) {
  let t = tiers[0];
  for (const x of tiers) if (value >= x.from) t = x;
  return t;
}

// Smart Mining budget slider: position 0 to 1000 on a square-root curve, so the small budgets get room and the tiers
// spread out along the track. The budget snaps to $50 steps; the thumb follows the finger, not the snapped value.
const STEP = 50;
export function budgetFromPos(pos) {
  const p = Math.min(1000, Math.max(0, Number(pos) || 0)) / 1000;
  const raw = SMART.min + (SMART.max - SMART.min) * p * p;
  return Math.min(SMART.max, Math.max(SMART.min, Math.round(raw / STEP) * STEP));
}
export function posFromBudget(budget) {
  const b = Math.min(SMART.max, Math.max(SMART.min, Number(budget) || SMART.min));
  return Math.round(1000 * Math.sqrt((b - SMART.min) / (SMART.max - SMART.min)));
}
