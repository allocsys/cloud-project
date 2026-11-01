// Public landing numbers: how many miners are running and their total hash power. Real data, never invented.
// Worked out from the loaded accounts (demo and closed accounts left out) and kept for a minute.
import { allUsers, warm } from '@/lib/server/db';

const TTL = 60000;
let cache = null;

export async function publicStats() {
  if (cache && Date.now() - cache.at < TTL) return cache.v;
  await warm();
  const list = await allUsers();
  let miners = 0;
  let th = 0;
  for (const u of list) {
    if (u.closedAt || u.id === 'demo') continue;
    for (const c of u.contracts || []) {
      if (!c.online) continue;
      miners += 1;
      th += Number(c.th) || 0;
    }
  }
  const v = { miners, th: Math.round(th * 10) / 10 };
  cache = { at: Date.now(), v };
  return v;
}
