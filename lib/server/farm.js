// Videos shown in the "Our farm" section of the landing page, kept in the meta entry "farm" (a list, in the order shown). Rules: lib/farm.js.
import { randomBytes } from 'node:crypto';
import { warm, metaGet, metaUpdate } from '@/lib/server/db';
import { cleanVideo, FARM_MAX } from '@/lib/farm';

const fail = (status, error) => ({ ok: false, status, error });
const done = { ok: true, status: 200 };

export async function farmVideos() {
  await warm();
  const v = metaGet('farm');
  return Array.isArray(v) ? v : [];
}

// Adds a video at the end, or changes the one with input.id. Runs under a lock on the entry, so two admins cannot overwrite each other.
export function saveFarmVideo(input) {
  const c = cleanVideo(input);
  if (c.error) return fail(422, c.error);
  const id = String(input?.id ?? '');
  return metaUpdate('farm', (cur) => {
    const list = Array.isArray(cur) ? [...cur] : [];
    if (id) {
      const i = list.findIndex((v) => v.id === id);
      if (i < 0) return { result: fail(404, 'Video not found.') };
      list[i] = { ...c.video, id };
    } else {
      if (list.length >= FARM_MAX) return { result: fail(409, `Up to ${FARM_MAX} videos.`) };
      list.push({ ...c.video, id: randomBytes(4).toString('hex') });
    }
    return { value: list, result: done };
  });
}

export function deleteFarmVideo(id) {
  const want = String(id ?? '');
  return metaUpdate('farm', (cur) => {
    const list = Array.isArray(cur) ? cur : [];
    if (!list.some((v) => v.id === want)) return { result: fail(404, 'Video not found.') };
    return { value: list.filter((v) => v.id !== want), result: done };
  });
}

// Moves a video one place up or down. At the top or bottom nothing changes.
export function moveFarmVideo(id, dir) {
  const want = String(id ?? '');
  if (dir !== 'up' && dir !== 'down') return fail(400, 'Choose up or down.');
  return metaUpdate('farm', (cur) => {
    const list = Array.isArray(cur) ? [...cur] : [];
    const i = list.findIndex((v) => v.id === want);
    if (i < 0) return { result: fail(404, 'Video not found.') };
    const j = dir === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= list.length) return { result: done };
    [list[i], list[j]] = [list[j], list[i]];
    return { value: list, result: done };
  });
}
