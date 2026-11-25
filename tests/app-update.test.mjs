import test from 'node:test';
import assert from 'node:assert/strict';
import { pickTag, cleanManifest, answerFor, releaseUrl } from '@/lib/app-update';

const sha = (c) => c.repeat(64);
const manifest = (over = {}) => ({
  versionCode: 12,
  versionName: '1.0.12',
  apk: { name: 'vertexhash-12.apk', size: 5000000, sha256: sha('a') },
  patch: { from: 11, name: 'patch-11-12.vxp', size: 90000, sha256: sha('b'), base: sha('c') },
  ...over,
});

test('pickTag takes the newest published app release and skips the rest', () => {
  assert.equal(pickTag([{ tag_name: 'v2' }, { tag_name: 'app-v9', draft: true }, { tag_name: 'app-v8', prerelease: true }, { tag_name: 'app-v7' }, { tag_name: 'app-v6' }]), 'app-v7');
  assert.equal(pickTag([{ tag_name: 'app-v1x' }, { tag_name: 'app-v' }]), null);
  assert.equal(pickTag(null), null);
});

test('a good manifest is kept; a changed name, hash, size or code is refused', () => {
  const ok = cleanManifest(manifest(), 'app-v12');
  assert.equal(ok.code, 12);
  assert.equal(ok.patch.from, 11);
  assert.equal(cleanManifest(manifest({ versionCode: 13 }), 'app-v12'), null);
  assert.equal(cleanManifest(manifest({ apk: { name: 'evil.apk', size: 5, sha256: sha('a') } }), 'app-v12'), null);
  assert.equal(cleanManifest(manifest({ apk: { name: 'vertexhash-12.apk', size: 5, sha256: 'xyz' } }), 'app-v12'), null);
  assert.equal(cleanManifest(manifest({ apk: { name: 'vertexhash-12.apk', size: 0, sha256: sha('a') } }), 'app-v12'), null);
  assert.equal(cleanManifest(manifest(), 'v12'), null);
  assert.equal(cleanManifest(null, 'app-v12'), null);
});

test('a bad patch is dropped but the full file stays', () => {
  const bad = cleanManifest(manifest({ patch: { from: 12, name: 'patch-12-12.vxp', size: 1, sha256: sha('b'), base: sha('c') } }), 'app-v12');
  assert.equal(bad.patch, null);
  assert.equal(bad.apk.name, 'vertexhash-12.apk');
  assert.equal(cleanManifest(manifest({ patch: { from: 11, name: 'other.vxp', size: 1, sha256: sha('b'), base: sha('c') } }), 'app-v12').patch, null);
  assert.equal(cleanManifest(manifest({ patch: { from: 11, name: 'patch-11-12.vxp', size: 1, sha256: sha('b'), base: 'nope' } }), 'app-v12').patch, null);
});

test('the app hears about a newer version only, and the patch only from the version it fits', () => {
  const v = cleanManifest(manifest(), 'app-v12');
  assert.deepEqual(answerFor(v, 12), { update: false });
  assert.deepEqual(answerFor(v, 20), { update: false });
  assert.deepEqual(answerFor(null, 3), { update: false });
  assert.deepEqual(answerFor(v, -1), { update: false });
  const a = answerFor(v, 11);
  assert.equal(a.update, true);
  assert.equal(a.apk.url, releaseUrl('app-v12', 'vertexhash-12.apk'));
  assert.equal(a.patch.url, releaseUrl('app-v12', 'patch-11-12.vxp'));
  assert.equal(a.patch.base, sha('c'));
  const b = answerFor(v, 5);
  assert.equal(b.patch, undefined);
  assert.ok(b.apk.url.startsWith('https://github.com/allocsys/cloud-project/releases/download/'));
});
