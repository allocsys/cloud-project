import test from 'node:test';
import assert from 'node:assert/strict';
import { fileKey, answerFor } from '@/lib/app-update';
import { DOWNLOAD_URL } from '@/lib/app-download';
import { bucketConfig, presignGet } from '@/lib/server/bucket';
import { edgeFree } from '@/lib/edge';

test('only the app and its patches of a release can be asked for', () => {
  assert.equal(fileKey('app-v12', 'vertexhash-12.apk'), 'app-v12/vertexhash-12.apk');
  assert.equal(fileKey('app-v12', 'patch-11-12.vxp'), 'app-v12/patch-11-12.vxp');
  for (const [t, f] of [['app-v12', 'vertexhash-11.apk'], ['app-v12', 'latest.json'], ['app-v12', '../latest.json'], ['app-v12', 'patch-10-11.vxp'], ['x', 'vertexhash-12.apk'], [null, null]]) assert.equal(fileKey(t, f), null);
});

// The worked example in Amazon's documentation "Authenticating requests: using query parameters".
test('a signed link matches the published AWS example', () => {
  const c = { endpoint: 'https://s3.amazonaws.com', bucket: 'examplebucket', keyId: 'AKIAIOSFODNN7EXAMPLE', secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1' };
  const url = presignGet(c, 'test.txt', 86400, new Date('2013-05-24T00:00:00.000Z'));
  assert.ok(url.startsWith('https://examplebucket.s3.amazonaws.com/test.txt?'));
  assert.ok(url.endsWith('&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404'), url);
});

test('the bucket is off until its variables are set', () => {
  assert.equal(bucketConfig({}), null);
  assert.equal(bucketConfig({ APK_S3_ENDPOINT: 'https://a.b', APK_S3_BUCKET: 'x', APK_S3_KEY_ID: 'k', APK_S3_SECRET: 's' }).region, 'auto');
});

test('a release in the bucket is downloaded through our own link', () => {
  const v = { tag: 'app-v12', code: 12, name: '1.0.2', bucket: true, apk: { name: 'vertexhash-12.apk', size: 1, sha256: 'a' }, patch: null };
  assert.equal(answerFor(v, 9).apk.url, `${DOWNLOAD_URL}?tag=app-v12&file=vertexhash-12.apk`);
});

test('only the exact download path skips the edge check', () => {
  assert.ok(edgeFree('/api/download'));
  assert.ok(!edgeFree('/api/download/x'));
  assert.ok(!edgeFree('/api/downloads'));
});
