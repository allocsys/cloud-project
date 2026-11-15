// Real figures about the whole service, for the public network cards (landing /api/network, /status, dashboard).
import { q } from '@/lib/server/db';

// Miners running right now across all accounts: active and switched on. 0 when the database cannot answer.
export async function minersRunning() {
  try {
    const r = await q(
      `SELECT COUNT(*)::int AS n
         FROM users u, jsonb_array_elements(CASE WHEN jsonb_typeof(u.data->'contracts') = 'array' THEN u.data->'contracts' ELSE '[]'::jsonb END) c
        WHERE COALESCE(c->>'status', 'active') = 'active' AND COALESCE(c->>'online', 'true') <> 'false'`
    );
    return r.rows[0]?.n ?? 0;
  } catch {
    return 0;
  }
}

// Proof that withdrawals are really paid, for the public /status page: only withdrawals an admin marked 'sent'.
// -> { count, btc (total, in BTC), hours (typical time from request to sent, null with none), last: [{ amount, asset, at }] (newest 10) }
// or null when the database cannot answer. It never returns a user id, an address or a transaction id.
export async function payoutProof() {
  try {
    const s = await q(
      `SELECT COUNT(*)::int AS n,
              COALESCE(SUM((data->>'btc')::numeric), 0)::float8 AS btc,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY CASE WHEN data->>'sentAt' IS NOT NULL THEN (data->>'sentAt')::bigint - at END)::float8 AS ms
         FROM withdrawals WHERE status = 'sent'`
    );
    const l = await q(
      `SELECT data->>'amount' AS amount, upper(COALESCE(data->>'asset', '')) AS asset, COALESCE((data->>'sentAt')::bigint, at) AS sent
         FROM withdrawals WHERE status = 'sent' ORDER BY sent DESC LIMIT 10`
    );
    const r = s.rows[0] || {};
    return {
      count: r.n ?? 0,
      btc: Number(r.btc) || 0,
      hours: r.ms === null || r.ms === undefined ? null : Math.max(0, Number(r.ms) / 3600000),
      last: l.rows.map((x) => ({ amount: String(x.amount ?? ''), asset: x.asset, at: Number(x.sent) })),
    };
  } catch {
    return null;
  }
}
