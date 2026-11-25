// The app update check: pure rules, shared by the route and the tests.
// Releases live on GitHub (made by .github/workflows/android.yml, tag app-v<versionCode>). The site only tells the app what is new,
// and builds every download link itself from a fixed address, so a changed manifest can never point the app somewhere else.
export const REPO = 'allocsys/cloud-project';
const TAG = /^app-v(\d{1,9})$/;
const SHA = /^[0-9a-f]{64}$/;
const NAME = /^[\w.-]{1,20}$/;
const MAX = 200 * 1024 * 1024;

export const releaseUrl = (tag, file) => `https://github.com/${REPO}/releases/download/${tag}/${file}`;

// The newest published release (the list comes newest first) whose tag is app-v<number>.
export function pickTag(list) {
  for (const r of Array.isArray(list) ? list : []) {
    if (r && !r.draft && !r.prerelease && typeof r.tag_name === 'string' && TAG.test(r.tag_name)) return r.tag_name;
  }
  return null;
}

const file = (f, name) => {
  if (!f || f.name !== name || !SHA.test(f.sha256) || !Number.isInteger(f.size) || f.size < 1 || f.size > MAX) return null;
  return { name, size: f.size, sha256: f.sha256 };
};

// The manifest of one release; null when anything is off.
export function cleanManifest(m, tag) {
  const num = TAG.exec(tag || '');
  if (!num || !m || m.versionCode !== Number(num[1]) || typeof m.versionName !== 'string' || !NAME.test(m.versionName)) return null;
  const code = m.versionCode;
  const apk = file(m.apk, `vertexhash-${code}.apk`);
  if (!apk) return null;
  let patch = null;
  const p = m.patch;
  if (p && Number.isInteger(p.from) && p.from > 0 && p.from < code) {
    const f = file(p, `patch-${p.from}-${code}.vxp`);
    if (f && SHA.test(p.base)) patch = { ...f, from: p.from, base: p.base };
  }
  return { tag, code, name: m.versionName, apk, patch };
}

// What the app gets. A patch is offered only to the version it was made from.
export function answerFor(v, have) {
  if (!v || !Number.isInteger(have) || have < 0 || have >= v.code) return { update: false };
  const out = {
    update: true,
    code: v.code,
    name: v.name,
    apk: { url: releaseUrl(v.tag, v.apk.name), size: v.apk.size, sha256: v.apk.sha256 },
  };
  if (v.patch && v.patch.from === have) {
    out.patch = { url: releaseUrl(v.tag, v.patch.name), size: v.patch.size, sha256: v.patch.sha256, base: v.patch.base };
  }
  return out;
}
