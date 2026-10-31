// Builds a new contract from a plan and handles serial numbers.
// Shared by the server (the real record) and the browser (instant preview while the server confirms).
// A miner ID is VTX-0004405.
export const serialNumber = (s) => parseInt(/^VTX-(\d+)$/.exec(String(s))?.[1], 10);
export const formatSerial = (n) => `VTX-${String(n).padStart(7, '0')}`;

export function makeContract(plan, serial, now = new Date()) {
  const end = new Date(now.getTime() + plan.days * 86400000);
  const dates = {
    started: now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    ends: end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
  };
  // Smart Mining (lib/smart.js): paid from the coin picked each day, so it has no TH/s and no hall of its own.
  if (plan.smart) {
    return {
      serial,
      online: true,
      name: plan.name,
      plan: plan.name,
      th: 0,
      hall: plan.hall,
      smart: true,
      budget: plan.budget,
      baseYield: plan.baseYield,
      ...(plan.reserve ? { reserve: plan.reserve } : {}),
      ...dates,
      days: plan.days,
      elapsed: 0,
      startDay: now.getDate(),
      startedAt: now.getTime(),
      dailyUsd: parseFloat(String(plan.daily).replace('$', '')),
      price: plan.price,
      status: 'active',
    };
  }
  return {
    serial,
    online: true,
    name: `${plan.name} ${plan.th} TH/s`,
    plan: plan.name,
    th: plan.th,
    hall: plan.hall,
    started: now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    ends: end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
    days: plan.days,
    elapsed: 0,
    startDay: now.getDate(),
    startedAt: now.getTime(),
    dailyUsd: parseFloat(String(plan.daily).replace('$', '')),
    price: plan.price,
    status: 'active',
  };
}
