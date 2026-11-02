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
