// The wallets a signed-in user connects in the app. Saved on the account so the admin user card can show them
// (lib/server/admin.js adminUserWallets). Only the address and chain are kept; the wallet itself never talks to us.
import { withUser } from '@/lib/server/db';

const EVM = /^0x[0-9a-fA-F]{40}$/;
const TON = /^(?:[A-Za-z0-9_-]{48}|-?\d:[0-9a-fA-F]{64})$/;
const KEEP = 10;

export async function saveWallet(id, input) {
  const address = String(input?.address ?? '').trim();
  const chain = input?.chain === 'evm' || input?.chain === 'ton' ? input.chain : '';
  if (!chain || !(chain === 'evm' ? EVM : TON).test(address)) return { ok: false, status: 422, error: 'Not a wallet address.' };
  await withUser(id, (u) => {
    const kept = (u.wallets || []).filter((x) => x.address !== address);
    u.wallets = [...kept, { address, chain, at: Date.now() }].slice(-KEEP);
  });
  return { ok: true, status: 200 };
}
