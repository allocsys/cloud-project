// Cloudflare Workers KV over the REST API. Values are raw bytes (one KV value is limited to 25 MiB).
const API = 'https://api.cloudflare.com/client/v4';

export function kvClient({ account, namespace, token, fetchFn = fetch }) {
  const base = `${API}/accounts/${account}/storage/kv/namespaces/${namespace}`;
  const auth = { Authorization: `Bearer ${token}` };
  const valueUrl = (key) => `${base}/values/${encodeURIComponent(key)}`;

  return {
    async put(key, body) {
      const r = await fetchFn(valueUrl(key), { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/octet-stream' }, body });
      if (!r.ok) throw new Error(`KV write failed (${r.status}).`);
    },
    async get(key) {
      const r = await fetchFn(valueUrl(key), { headers: auth });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`KV read failed (${r.status}).`);
      return Buffer.from(await r.arrayBuffer());
    },
    async del(key) {
      const r = await fetchFn(valueUrl(key), { method: 'DELETE', headers: auth });
      if (!r.ok && r.status !== 404) throw new Error(`KV delete failed (${r.status}).`);
    },
    async list(prefix = '') {
      const names = [];
      let cursor = '';
      do {
        const q = `limit=1000&prefix=${encodeURIComponent(prefix)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
        const r = await fetchFn(`${base}/keys?${q}`, { headers: auth });
        if (!r.ok) throw new Error(`KV list failed (${r.status}).`);
        const j = await r.json();
        for (const k of j.result || []) names.push(k.name);
        cursor = j.result_info?.cursor || '';
      } while (cursor);
      return names;
    },
  };
}
