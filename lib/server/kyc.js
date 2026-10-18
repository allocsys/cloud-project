// Identity verification. Storage lives in lib/server/db.js.
// Photos are checked and then dropped: only their size and type are kept.
// TODO: stream the photos to private object storage (S3 or R2) and queue them for review.
import { COUNTRIES, DOCS, MAX_PHOTO, ageOf } from '@/lib/kyc';
import { userOf, idem, remember, notify } from '@/lib/server/db';

export function getKyc(userId = 'demo') {
  const { status, submittedAt } = userOf(userId).kyc;
  return { status, submittedAt };
}

const fail = (status, error, field) => ({ ok: false, status, error, field });

const isPhoto = (f) => !!f && typeof f === 'object' && typeof f.size === 'number' && typeof f.type === 'string';

function checkPhoto(f, field, what) {
  if (!isPhoto(f) || f.size === 0) return fail(422, `Add ${what}.`, field);
  if (!f.type.startsWith('image/')) return fail(422, 'Photos must be images.', field);
  if (f.size > MAX_PHOTO) return fail(422, 'Photo is too large (max 12 MB).', field);
  return null;
}

// `form` is the multipart FormData from the browser. Same Idempotency-Key twice returns the first result.
export function submitKyc(form, { userId = 'demo', key } = {}) {
  const idemKey = key ? `kyc:${userId}:${key}` : null;
  if (idemKey && idem.has(idemKey)) return idem.get(idemKey);

  const name = String(form.get('name') ?? '').trim();
  const dob = String(form.get('dob') ?? '');
  const country = String(form.get('country') ?? '');
  const doc = String(form.get('doc') ?? '');
  const front = form.get('front');
  const selfie = form.get('selfie');

  if (name.length > 100 || name.split(/\s+/).length < 2) return fail(422, 'Enter your first and last name.', 'name');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return fail(422, 'Enter your date of birth.', 'dob');
  const age = ageOf(dob);
  if (age < 18) return fail(422, 'You must be 18 or older.', 'dob');
  if (age > 120) return fail(422, 'Enter your date of birth.', 'dob');
  if (!COUNTRIES.includes(country)) return fail(422, 'Choose your country.', 'country');
  if (!DOCS.includes(doc)) return fail(422, 'Choose a document type.', 'doc');
  const bad = checkPhoto(front, 'front', 'a photo of your document') || checkPhoto(selfie, 'selfie', 'a selfie');
  if (bad) return bad;

  // No awaits from here on, so two submits cannot both pass this check.
  const u = userOf(userId);
  if (u.kyc.status !== 'none') return fail(409, 'Verification was already submitted.');

  u.kyc = {
    status: 'pending',
    submittedAt: Date.now(),
    name,
    dob,
    country,
    doc,
    photos: { front: { size: front.size, type: front.type }, selfie: { size: selfie.size, type: selfie.type } },
  };
  notify(u, { kind: 'news', title: 'Verification submitted', body: 'Your details are in review.' });

  const result = { ok: true, status: 200, kyc: getKyc(userId) };
  return idemKey ? remember(idemKey, result) : result;
}
