// Bot check (Cloudflare Turnstile). Off until TURNSTILE_SITEKEY and TURNSTILE_SECRET are both set: then sign-in, sign-up and the
// password-reset request need a passed check. With either one missing nothing changes.
import { clientIp } from '@/lib/server/auth';

export const captchaKey = () => (process.env.TURNSTILE_SITEKEY && process.env.TURNSTILE_SECRET ? process.env.TURNSTILE_SITEKEY : null);

const VERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

// true = the person may go on. No token never reaches Cloudflare. If Cloudflare cannot be reached the check fails closed.
export async function captchaOk(req, token) {
  if (!captchaKey()) return true;
  const t = typeof token === 'string' ? token.trim() : '';
  if (!t || t.length > 2048) return false;
  try {
    const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET, response: t });
    const ip = clientIp(req);
    if (ip && ip !== 'unknown') body.set('remoteip', ip);
    const r = await fetch(VERIFY, { method: 'POST', body, signal: AbortSignal.timeout(5000), cache: 'no-store' });
    const j = await r.json();
    return j?.success === true;
  } catch {
    return false;
  }
}
