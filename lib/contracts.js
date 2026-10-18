// Builds a new contract from a plan and handles serial numbers.
// Shared by the server (the real record) and the browser (instant preview while the server confirms).
export const serialNumber = (s) => parseInt(String(s).slice(3), 10);
export const formatSerial = (n) => `OP-${String(n).padStart(7, '0')}`;

export function makeContract(plan, serial, now = new Date()) {
  const end = new Date(now.getTime() + plan.days * 86400000);
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
    dailyUsd: parseFloat(String(plan.daily).replace('$', '')),
    status: 'active',
  };
}
