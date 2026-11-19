// A short memory of sessions that were just checked, so a busy screen does not ask the database about the same cookie on
// every call. Positive answers only, and only for `ttl` ms. forget(id) drops an account (password change, block, close) and
// makes any check that was already running unable to store its older answer.
export function sessionCache(ttl = 2000, max = 5000, now = Date.now) {
  const m = new Map();
  let ver = 0;
  return {
    get(token) {
      const h = m.get(token);
      if (!h) return null;
      if (h.until <= now()) {
        m.delete(token);
        return null;
      }
      return h.id;
    },
    mark: () => ver, // take before the database check, hand to set() after it
    set(token, id, seen) {
      if (seen !== ver) return;
      if (m.size >= max) {
        const t = now();
        for (const [k, v] of m) if (v.until <= t) m.delete(k);
        if (m.size >= max) m.clear();
      }
      m.set(token, { id, until: now() + ttl });
    },
    forget(id) {
      ver += 1;
      for (const [k, v] of m) if (v.id === id) m.delete(k);
    },
    clear() {
      ver += 1;
      m.clear();
    },
  };
}
