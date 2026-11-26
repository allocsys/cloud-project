// The level badge on Settings > Security. A confirmed way to reach the person (verified email) and two-factor each count once.
export function securityLevel(me) {
  const n = (me?.email && me?.verified ? 1 : 0) + (me?.twofa ? 1 : 0);
  return n >= 2 ? 'high' : n === 1 ? 'medium' : 'low';
}
