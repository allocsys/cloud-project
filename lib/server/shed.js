// Load shedding for API routes: when a server is overloaded it answers at once with a clear 503 or 429 and a Retry-After,
// instead of letting requests queue until they time out. Free of Next imports, so plain Node tests can load it.
import { AsyncLocalStorage } from 'node:async_hooks';

// True while code runs for a guarded API route. Only such code is ever refused: background jobs, the payment webhook, health
// checks and the bot are not wrapped, so they keep waiting for the pool as before.
const inRoute = new AsyncLocalStorage();

export const BUSY = 'Busy right now. Try again in a few seconds.';
export const SLOW_DOWN = 'Too many requests. Try again in a minute.';

export class Shed extends Error {
  constructor(status, message, retry) {
    super(message);
    this.status = status;
    this.retry = retry;
  }
}

// A route handler that turns a Shed into its answer (status, JSON error, Retry-After). Any other error is thrown on as before.
export const guarded = (fn) => (...args) =>
  inRoute.run(true, async () => {
    try {
      return await fn(...args);
    } catch (e) {
      if (!(e instanceof Shed)) throw e;
      return new Response(JSON.stringify({ ok: false, error: e.message }), {
        status: e.status,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'retry-after': String(e.retry) },
      });
    }
  });

// Past `max` requests already waiting for a connection, a guarded route is refused at once with 503 (the caller retries in a
// few seconds) instead of joining the queue. Works for pool.connect() and for pool.query(), which connects internally.
export function capWaiters(pool, max) {
  const connect = pool.connect.bind(pool);
  pool.connect = (cb) => {
    if (inRoute.getStore() && pool.waitingCount >= max) {
      const e = new Shed(503, BUSY, 3);
      if (typeof cb === 'function') {
        process.nextTick(cb, e);
        return undefined;
      }
      return Promise.reject(e);
    }
    return connect(cb);
  };
  return pool;
}
