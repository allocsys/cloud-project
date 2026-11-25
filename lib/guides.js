// The public guide pages. id = the message key prefix (gd.<id>.t, gd.<id>.desc, gd.<id>.d), path = the address.
// parts: ['d'] is one paragraph; named parts each show a small heading (gd.<id>.<part>.t) and a paragraph (gd.<id>.<part>.d).
// The English texts were approved by the owner on 25 Nov 2026. No typed income, payout or fee figures.
export const GUIDES = [
  { id: 'cloud', path: '/what-is-cloud-mining', parts: ['d'] },
  { id: 'pay', path: '/how-payouts-work', parts: ['d'] },
  { id: 'coins', path: '/coins-we-mine', parts: ['d'] },
  { id: 'vs', path: '/cloud-mining-vs-buying', parts: ['buy', 'cloud', 'both'] },
  { id: 'hash', path: '/what-is-hashrate', parts: ['d'] },
];
