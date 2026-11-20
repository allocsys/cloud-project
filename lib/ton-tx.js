// Turns the gateway's TON payment link into a transfer a wallet can be asked to send (Connect wallet in Telegram, TON Connect).
// Native TON only: 'ton://transfer/<address>?amount=<nanoton>'. Returns { to, amount } (amount = nanoton as a decimal string), or null.
// A link with a jetton (USDT on TON) is null: its amount is in token units and must never be sent as nanoton.
const ADDR = /^[A-Za-z0-9_-]{48}$/;
const INT = /^[1-9]\d{0,37}$/;

export function tonTx(uri) {
  const m = /^ton:\/\/transfer\/([^?]+)\?(.+)$/.exec(String(uri || ''));
  if (!m || !ADDR.test(m[1])) return null;
  const q = new URLSearchParams(m[2]);
  if (q.has('jetton')) return null;
  const amount = q.get('amount') || '';
  return INT.test(amount) ? { to: m[1], amount } : null;
}
