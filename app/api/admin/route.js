import { NextResponse } from 'next/server';
import { COOKIE, MAX_AGE, adminEnabled, isAdmin, needsSetup, overview, act } from '@/lib/server/admin';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (body, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

function gate(req) {
  if (!adminEnabled()) return json({ ok: false, off: true, error: 'Admin is off. Set ADMIN_TOKEN (12 or more characters) and redeploy.' }, 503);
  if (!isAdmin(req)) return json({ ok: false, error: 'Sign in required.', setup: needsSetup() }, 401);
  return null;
}

export async function GET(req) {
  return gate(req) || json({ ok: true, ...overview() });
}

export async function POST(req) {
  const denied = gate(req);
  if (denied) return denied;
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'Invalid request.' }, 400);
  }
  const { status, session, ...rest } = act(body);
  const res = json(rest, status);
  // A new password ends the old sessions, so this browser gets a fresh one.
  if (session) res.cookies.set(COOKIE, session, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: MAX_AGE });
  return res;
}
