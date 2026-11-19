// A repeating timer whose gap is random (ms +-20% by default), so servers started together drift apart instead of all
// asking the database or a feed at the same second. Does not wait for run(): a round that hangs never stops the timer.
// Returns a handle; stop() ends it. The timer never keeps the process alive.
export function jitterEvery(run, ms, spread = 0.2) {
  const h = { t: null, stopped: false, stop() { h.stopped = true; clearTimeout(h.t); } };
  const next = () => {
    const gap = Math.max(1, Math.round(ms * (1 - spread + Math.random() * 2 * spread)));
    h.t = setTimeout(() => {
      if (h.stopped) return;
      Promise.resolve().then(run).catch(() => {});
      next();
    }, gap);
    h.t.unref?.();
  };
  next();
  return h;
}
