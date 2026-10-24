import { redirect } from 'next/navigation';

// Sign-in is a sheet on the home page now (components/AuthSheet.js). Old links to /login (invite links, emailed reset
// links, bookmarks) still work: they land on the home page with the same query and the sheet opens there.
export default async function Login({ searchParams }) {
  const q = (await searchParams) || {};
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    const s = Array.isArray(v) ? v[0] : v;
    if (typeof s === 'string') p.set(k, s);
  }
  if (!p.has('auth')) p.set('auth', '1');
  redirect(`/?${p.toString()}`);
}
