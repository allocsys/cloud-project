import { NextResponse } from 'next/server';
import { latestApp } from '@/lib/server/app-update';
import { bucketConfig, presignGet } from '@/lib/server/bucket';
import { fileKey, releaseUrl } from '@/lib/app-update';

export const dynamic = 'force-dynamic';

const to = (url) => new NextResponse(null, { status: 302, headers: { Location: url, 'Cache-Control': 'no-store' } });
const fail = (status, error) => NextResponse.json({ ok: false, error }, { status, headers: { 'Cache-Control': 'no-store' } });

// Public. No query: the newest app. ?tag=app-vN&file=NAME: one file of one release (the in-app update).
// Answers with a redirect: to a 10-minute bucket link, or to GitHub while the newest release is not in the bucket.
export async function GET(req) {
  const p = new URL(req.url).searchParams;
  const c = bucketConfig();
  if (p.has('tag') || p.has('file')) {
    const key = fileKey(p.get('tag'), p.get('file'));
    if (!key || !c) return fail(404, 'Not found.');
    return to(presignGet(c, key));
  }
  const v = await latestApp();
  if (!v) return fail(503, 'Try again in a minute.');
  return to(v.bucket && c ? presignGet(c, `${v.tag}/${v.apk.name}`) : releaseUrl(v.tag, v.apk.name));
}
