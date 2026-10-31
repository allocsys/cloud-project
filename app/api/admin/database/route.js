import { NextResponse } from 'next/server';
import { adminEnabled, isAdmin } from '@/lib/server/admin';
import { databaseOverview, tableRows, deleteRow, clearTable, dropTable } from '@/lib/server/db-admin';
import { makeBackup, inspectBackup, restoreBackup, MAX_UPLOAD } from '@/lib/server/db-backup';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (body, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

async function gate(req) {
  if (!adminEnabled()) return json({ ok: false, off: true, error: 'Admin is off. Set ADMIN_TOKEN (12 or more characters) and redeploy.' }, 503);
  if (!(await isAdmin(req))) return json({ ok: false, error: 'Sign in required.' }, 401);
  return null;
}

// No query: the overview. ?table=name: the newest rows of that table (read only). ?backup=1: the whole database as one gzipped file.
export async function GET(req) {
  const denied = await gate(req);
  if (denied) return denied;
  const params = new URL(req.url).searchParams;
  if (params.get('backup') === '1') {
    const b = await makeBackup();
    if (!b.ok) return json(b, 500);
    const stamp = b.at.slice(0, 16).replace('T', '-').replace(':', '');
    return new NextResponse(b.buf, {
      status: 200,
      headers: { ...NO_STORE, 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="vertexhash-backup-${stamp}.gz"` },
    });
  }
  const table = params.get('table');
  const r = table === null ? await databaseOverview() : await tableRows(table);
  return json(r, r.ok ? 200 : 400);
}

// The file is the request body. ?action=inspect: what it holds next to what the database holds now (changes nothing).
// ?action=restore&confirm=RESTORE: replaces all data with the file's, all or nothing.
export async function POST(req) {
  const denied = await gate(req);
  if (denied) return denied;
  const params = new URL(req.url).searchParams;
  const action = params.get('action');
  if (action !== 'inspect' && action !== 'restore') return json({ ok: false, error: 'Unknown action.' }, 400);
  if ((Number(req.headers.get('content-length')) || 0) > MAX_UPLOAD) return json({ ok: false, error: 'The file is too big.' }, 413);
  const buf = Buffer.from(await req.arrayBuffer());
  const r = action === 'inspect' ? await inspectBackup(buf) : await restoreBackup(buf, params.get('confirm'));
  return json(r, r.ok ? 200 : 400);
}

// Changes one table. ?table=name&mode=row with a body { key } removes that one row; mode=clear removes every row; mode=drop drops a table
// the app does not use. clear and drop need &confirm=<the table name>.
export async function DELETE(req) {
  const denied = await gate(req);
  if (denied) return denied;
  const params = new URL(req.url).searchParams;
  const table = params.get('table');
  const mode = params.get('mode');
  let r;
  if (mode === 'row') {
    let body = {};
    try {
      body = await req.json();
    } catch {}
    r = await deleteRow(table, body?.key);
  } else if (mode === 'clear') {
    r = await clearTable(table, params.get('confirm'));
  } else if (mode === 'drop') {
    r = await dropTable(table, params.get('confirm'));
  } else {
    return json({ ok: false, error: 'Unknown action.' }, 400);
  }
  return json(r, r.ok ? 200 : 400);
}
