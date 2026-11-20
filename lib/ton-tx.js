// Turns the gateway's TON payment link into a transfer a wallet can be asked to send (Connect wallet in Telegram, TON Connect).
// Native TON only: 'ton://transfer/<address>?amount=<nanoton>'. Returns { to, amount } (amount = nanoton as a decimal string), or null.
const ADDR = /^[A-Za-z0-9_-]{48}$/;
const INT = /^[1-9]\d{0,37}$/;

export function tonTx(uri) {
  const m = /^ton:\/\/transfer\/([^?]+)\?(.+)$/.exec(String(uri || ''));
  if (!m || !ADDR.test(m[1])) return null;
  const amount = new URLSearchParams(m[2]).get('amount') || '';
  return INT.test(amount) ? { to: m[1], amount } : null;
}
