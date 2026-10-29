import test from 'node:test';
import assert from 'node:assert/strict';
import { mailText } from '@/lib/i18n/mail';

test('English emails read as before', () => {
  const r = mailText('en', 'reset', { url: 'https://x.test/a' });
  assert.equal(r.subject, 'Reset your Vertexhash password');
  assert.equal(r.text, 'Someone asked to reset the password for your Miner Opus account.\n\nOpen this link within 30 minutes to choose a new password:\nhttps://x.test/a\n\nIf this was not you, ignore this email. Your password stays the same.');
  assert.equal(mailText('en', 'verify', { url: 'u' }).subject, 'Confirm your Miner Opus email');
  assert.equal(mailText('en', 'code', { code: '123456' }).text, 'Your code to add this email to your Miner Opus account:\n\n123456\n\nIt works for 15 minutes. If you did not ask for it, ignore this email.');
});

test('Persian emails carry the link or code and no raw keys', () => {
  for (const [kind, vars, needle] of [['reset', { url: 'https://x.test/a' }, 'https://x.test/a'], ['verify', { url: 'https://x.test/b' }, 'https://x.test/b'], ['code', { code: '654321' }, '654321']]) {
    const r = mailText('fa', kind, vars);
    assert.ok(!r.subject.startsWith('mail.') && !r.text.startsWith('mail.'));
    assert.ok(r.text.includes(needle));
    assert.ok(!r.text.includes('{'));
    assert.match(r.subject, /Miner Opus/);
    assert.match(r.text, /[\u0600-\u06ff]/);
  }
});
