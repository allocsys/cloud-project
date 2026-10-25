// Which checkout provider new payments use, chosen in the admin Gateway tab. It lives in the meta entry "payprovider" { choice, at };
// a change reaches every server within a few seconds (the meta cache). With no choice saved, PAY_PROVIDER decides (lib/server/pay-provider.js).
// Orders already open keep the provider that made them: their callbacks are accepted from either (verifyCallback).
import { warm, metaGet, metaUpdate } from '@/lib/server/db';
import { provider, setProviderChoice, readyFor } from '@/lib/server/pay-provider';

const fail = (status, error) => ({ ok: false, status, error });

// Reads the saved choice into pay-provider.js. Call it before anything that asks provider() or cryptoEnabled().
export async function loadProvider() {
  await warm();
  setProviderChoice(metaGet('payprovider')?.choice);
  return provider();
}

// What the admin screen shows: the provider in use, the saved choice (null = the environment decides) and which providers are set up.
export async function providerSettings() {
  await loadProvider();
  return { active: provider(), saved: metaGet('payprovider')?.choice || null, ready: { nowpayments: readyFor('nowpayments'), gateway: readyFor('gateway') } };
}

export async function saveProvider(input) {
  const choice = String(input?.provider ?? '').trim().toLowerCase();
  if (choice !== 'gateway' && choice !== 'nowpayments') return fail(400, 'Choose NOWPayments or the gateway.');
  if (!readyFor(choice)) {
    return fail(409, choice === 'gateway' ? 'The gateway is not set up (GATEWAY_URL, GATEWAY_API_SECRET and GATEWAY_WEBHOOK_SECRET).' : 'NOWPayments is not set up (NOWPAYMENTS_API_KEY and NOWPAYMENTS_IPN_SECRET).');
  }
  await metaUpdate('payprovider', () => ({ value: { choice, at: Date.now() } }));
  setProviderChoice(choice);
  return { ok: true, status: 200, provider: choice };
}
