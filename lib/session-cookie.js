// The name of the session cookie. Shared by the pages (to know a visitor has one) and by lib/server/auth.js (which signs and checks it).
// A plain constant on purpose: the web pages must not import lib/server just to read a name.
export const SESSION_COOKIE = 'vtx_session';
