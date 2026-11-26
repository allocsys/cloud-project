// The Railway bucket that holds the app files (private). Only short-lived signed links are made here (AWS Signature V4, in the
// address), so the files go from the bucket straight to the phone. Off until the five APK_S3_* variables are set.
import { createHash, createHmac } from 'node:crypto';

export function bucketConfig(env = process.env) {
  const c = { endpoint: env.APK_S3_ENDPOINT, bucket: env.APK_S3_BUCKET, keyId: env.APK_S3_KEY_ID, secret: env.APK_S3_SECRET, region: env.APK_S3_REGION || 'auto' };
  return c.endpoint && c.bucket && c.keyId && c.secret ? c : null;
}

const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
const hash = (s) => createHash('sha256').update(s).digest('hex');
const hmac = (k, s) => createHmac('sha256', k).update(s).digest();

// A GET link for one file. Virtual-hosted style: the bucket name is part of the host (how Railway buckets work).
// saveAs: the file name the phone saves it under (otherwise the name in the bucket).
export function presignGet(c, key, seconds = 600, now = new Date(), saveAs = null) {
  const host = `${c.bucket}.${new URL(c.endpoint).host}`;
  const path = `/${key.split('/').map(enc).join('/')}`;
  const stamp = now.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const day = stamp.slice(0, 8);
  const scope = `${day}/${c.region}/s3/aws4_request`;
  const query = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${c.keyId}/${scope}`],
    ['X-Amz-Date', stamp],
    ['X-Amz-Expires', String(seconds)],
    ['X-Amz-SignedHeaders', 'host'],
    ...(saveAs ? [['response-content-disposition', `attachment; filename="${saveAs}"`]] : []),
  ]
    .map(([k, v]) => `${enc(k)}=${enc(v)}`)
    .join('&');
  const request = ['GET', path, query, `host:${host}`, '', 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, hash(request)].join('\n');
  const k = hmac(hmac(hmac(hmac(`AWS4${c.secret}`, day), c.region), 's3'), 'aws4_request');
  return `https://${host}${path}?${query}&X-Amz-Signature=${hmac(k, toSign).toString('hex')}`;
}
