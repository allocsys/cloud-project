import { NextResponse } from 'next/server';
import { readJson } from '@/lib/server/body';
import { COOKIE, MAX_AGE, adminEnabled, isAdmin, needsSetup, overview, act, adminList, adminRefList, adminUsers, adminUserHistory, adminUserWallets } from '@/lib/server/admin';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (body, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

async function gate(req) {
  if (!adminEnabled()) return json({ ok: false, off: true, error: 'Admin is off. Set ADMIN_TOKEN (12 or more characters) and redeploy.' }, 503);
  if (!(await isAdmin(req))) return json({ ok: false, error: 'Sign in required.', setup: await needsSetup() }, 401);
  return null;
}

export async function GET(req) {
  const denied = await gate(req);
  if (denied) return denied;
  const p = new URL(req.url).searchParams;
  if (p.get('list') === 'users') return json({ ok: true, ...(await adminUsers({ q: p.get('q'), filter: p.get('filter'), sort: p.get('sort'), offset: p.get('offset'), limit: p.get('limit') })) });
  if (p.has('wallets')) {
    const w = await adminUserWallets(p.get('wallets'));
    return w ? json({ ok: true, ...w }) : json({ ok: false, error: 'User not found.' }, 404);
  }
  if (p.has('history')) {
    const history = await adminUserHistory(p.get('history'));
    return history ? json({ ok: true, history }) : json({ ok: false, error: 'User not found.' }, 404);
  }
  if (['friends', 'tickets', 'invitefails'].includes(p.get('list'))) return json({ ok: true, ...(await adminRefList(p.get('list'), { offset: p.get('offset'), limit: p.get('limit') })) });
  if (p.has('list')) {
    const page = adminList(p.get('list'), { filter: p.get('filter'), offset: p.get('offset'), limit: p.get('limit') });
    return page ? json({ ok: true, ...(await page) }) : json({ ok: false, error: 'Unknown list.' }, 400);
  }
  return json({ ok: true, ...(await overview()) });
}

export async function POST(req) {
  const denied = await gate(req);
  if (denied) return denied;
  let body;
  try {
    body = await readJson(req, 256 * 1024);
  } catch {
    return json({ ok: false, error: 'Invalid request.' }, 400);
  }
  const { status, session, ...rest } = await act(body);
  const res = json(rest, status);
  // A new password ends the old sessions, so this browser gets a fresh one.
  if (session) res.cookies.set(COOKIE, session, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: MAX_AGE });
  return res;
}
