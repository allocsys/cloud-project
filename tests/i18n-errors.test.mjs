import test from 'node:test';
import assert from 'node:assert/strict';
import { translateError } from '@/lib/i18n/errors';
import { LANGS } from '@/lib/i18n/langs';

test('English and unknown languages keep the server text', () => {
  assert.equal(translateError('en', 'Wrong email or password.'), 'Wrong email or password.');
  assert.equal(translateError('xx', 'Wrong email or password.'), 'Wrong email or password.');
  assert.equal(translateError('en', undefined), 'Something went wrong.');
});

test('a known message is shown in the language, with numbers and names filled in', () => {
  assert.equal(translateError('fa', 'Wrong email or password.'), LANGS.fa.messages['err.wrongLogin']);
  assert.equal(translateError('fa', 'You can have up to 5 codes.'), LANGS.fa.messages['err.maxCodes'].replace('{n}', '5'));
  assert.equal(translateError('fa', 'Enter a valid Bitcoin address.'), LANGS.fa.messages['wal.errAddr'].replace('{net}', 'Bitcoin'));
});

test('an unknown message, or one without a translation yet, stays English', () => {
  assert.equal(translateError('fa', 'Something nobody wrote down.'), 'Something nobody wrote down.');
  assert.equal(translateError('fa', 'Unknown ticket.'), LANGS.fa.messages['err.ticketUnknown'] || 'Unknown ticket.');
});
