// The decoy behind /password.txt (app/(site)/password.txt/route.js) and the same file in the repo root (tests/trap.test.mjs keeps them equal).
// Every name and password in it is made up and works nowhere. A sign-in that uses the decoy password, or the decoy name, is written to the
// trap list (lib/server/trap.js) and shows in Admin, Overview, Trap hits. Shared file: no Node-only imports.
export const DECOY = { admin: 'sysadmin', email: 'sysadmin@vertexhash.com', pass: 'Vx#Kestrel-4829-Lumen' };

export const DECOY_TEXT = `# Server access notes - DO NOT SHARE
# updated 2026-09-14

## Admin panel
url:  https://vertexhash.com/admin
user: ${DECOY.admin}
pass: ${DECOY.pass}

## App sign-in (same account)
email: ${DECOY.email}
pass:  ${DECOY.pass}

## Old staging database
host: db-staging.vertexhash.com
port: 5432
user: vtx_admin
pass: ${DECOY.pass}
`;

export const isDecoyPass = (p) => String(p ?? '') === DECOY.pass;
export const isDecoyUser = (u) => {
  const s = String(u ?? '').trim().toLowerCase();
  return s === DECOY.admin || s === DECOY.email;
};
