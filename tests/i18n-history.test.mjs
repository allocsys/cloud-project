import test from 'node:test';
import assert from 'node:assert/strict';
import { translate } from '@/lib/i18n/langs';
import { histLabel, histDate, histFee, histNet } from '@/lib/i18n/history';

const en = (k, v) => translate('en', k, v);
const fa = (k, v) => translate('fa', k, v);

test('English labels come back unchanged', () => {
  for (const label of ['Daily payout', 'Withdrawal · BTC', 'Boost ticket · $5', 'Starter plan', 'Custom 5 TH/s', 'Smart Mining $50', 'Refund · Pro plan', 'Invite bonus · ab…yz', 'Invite rebate · 5%']) {
    assert.equal(histLabel({ label }, en), label);
  }
});

test('Persian labels use the keys', () => {
  assert.equal(histLabel({ label: 'Withdrawal · BTC' }, fa), 'برداشت · BTC');
  assert.equal(histLabel({ label: 'Starter plan' }, fa), 'پلن استارتر');
  assert.equal(histLabel({ label: 'Daily payout' }, fa), 'پرداخت روزانه');
});

test('unknown labels stay English, approved text is Persian', () => {
  assert.equal(histLabel({ label: 'Something new' }, fa), 'Something new');
  assert.equal(histLabel({ label: 'Smart Mining $50' }, fa), 'ماینینگ هوشمند $50');
});

test('dates, fees and net', () => {
  assert.equal(histDate({ date: 'Just now' }, 'fa', fa), 'همین حالا');
  assert.equal(histDate({ date: '17 Oct', at: 1 }, 'en', en), '17 Oct');
  assert.match(histDate({ date: '17 Oct', at: Date.UTC(2026, 9, 17, 12) }, 'fa', fa), /^17 /);
  assert.equal(histFee('0.0001 BTC + $1.20 swap + $0.50 service', fa), '0.0001 BTC + $1.20 تبدیل + $0.50 خدمات');
  assert.equal(histNet('Balance', fa), 'موجودی');
  assert.equal(histNet('BTC', fa), 'BTC');
});
