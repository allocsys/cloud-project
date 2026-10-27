// Unsigned Solana transfer for an open invoice, so a connected wallet (WalletConnect) can be asked to sign and send it.
// Native SOL: a System Program transfer. USDT/USDC: an SPL Token TransferChecked between the payer's token account and ours.
// The legacy message is written by hand (no Solana library): the layout is short and fixed. Nothing here signs anything.
// The recent blockhash is only valid for about a minute, so the app asks for this right before the wallet is asked to sign.
import { base58 } from '@scure/base';
import { q } from './db.js';
import { config } from './config.js';
import { ApiError } from './http.js';
import { rpcClient } from './evm-scanner.js';
import { SOL_TOKENS, isSolAddress } from './chains/sol.js';

const SYSTEM_PROGRAM = new Uint8Array(32); // '1111...1' is 32 zero bytes
const TOKEN_PROGRAM = base58.decode('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

const cat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const u64 = (n) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n), true);
  return b;
};
const key = (s) => {
  const k = base58.decode(String(s));
  if (k.length !== 32) throw new ApiError(400, 'Invalid wallet address.');
  return k;
};

// Legacy message, one instruction. Account order: signer+writable, writable, readonly (as the format requires). Lengths here are all under 128, so each is one byte.
function message({ keys, readonlyUnsigned, blockhash, program, accounts, data }) {
  return cat(
    Uint8Array.of(1, 0, readonlyUnsigned, keys.length),
    ...keys,
    blockhash,
    Uint8Array.of(1, program, accounts.length, ...accounts, data.length),
    data,
  );
}

// SOL transfer: System Program instruction 2 (u32) then lamports (u64).
export function solMessage({ from, to, lamports, blockhash }) {
  return message({
    keys: [key(from), key(to), SYSTEM_PROGRAM],
    readonlyUnsigned: 1,
    blockhash,
    program: 2,
    accounts: [0, 1],
    data: cat(Uint8Array.of(2, 0, 0, 0), u64(lamports)),
  });
}

// Token transfer: Token Program instruction 12 (TransferChecked), amount (u64), decimals (u8). Accounts: source, mint, destination, owner.
export function tokenMessage({ owner, source, dest, mint, amount, decimals, blockhash }) {
  return message({
    keys: [key(owner), key(source), key(dest), key(mint), TOKEN_PROGRAM],
    readonlyUnsigned: 2,
    blockhash,
    program: 4,
    accounts: [1, 3, 2, 0],
    data: cat(Uint8Array.of(12), u64(amount), Uint8Array.of(decimals)),
  });
}

// A transaction with one empty signature slot (the wallet fills it), as base64.
export const unsignedTx = (msg) => Buffer.from(cat(Uint8Array.of(1), new Uint8Array(64), msg)).toString('base64');

const balanceOf = (a) => {
  const v = a?.account?.data?.parsed?.info?.tokenAmount?.amount;
  return typeof v === 'string' && /^\d{1,38}$/.test(v) ? BigInt(v) : 0n;
};

// `inv` is the invoice row (network, asset, address, expected_atomic, status, expires_at). Returns the base64 transaction.
export async function buildSolTx(inv, from, rpc, now = Date.now()) {
  if (!isSolAddress(from)) throw new ApiError(400, 'Invalid wallet address.');
  if (!inv) throw new ApiError(404, 'Invoice not found.');
  if (inv.network !== 'sol') throw new ApiError(400, 'Not a Solana invoice.');
  if (inv.status !== 'pending' || new Date(inv.expires_at).getTime() <= now) throw new ApiError(409, 'This invoice is no longer open.');
  if (inv.expected_atomic === null || inv.expected_atomic === undefined || !/^[1-9]\d*$/.test(String(inv.expected_atomic))) throw new ApiError(409, 'This invoice has no amount.');
  const amount = BigInt(String(inv.expected_atomic));
  const bh = await rpc.call('getLatestBlockhash', [{ commitment: 'confirmed' }]);
  const blockhash = base58.decode(String(bh?.value?.blockhash || ''));
  if (blockhash.length !== 32) throw new ApiError(503, 'Solana is not answering. Try again.');
  if (inv.asset === 'sol') return unsignedTx(solMessage({ from, to: inv.address, lamports: amount, blockhash }));
  const t = SOL_TOKENS[inv.asset];
  if (!t) throw new ApiError(400, 'Unsupported coin.');
  const opts = { encoding: 'jsonParsed', commitment: 'confirmed' };
  const [mine, ours] = await rpc.batch([
    { method: 'getTokenAccountsByOwner', params: [from, { mint: t.mint }, opts] },
    { method: 'getTokenAccountsByOwner', params: [inv.address, { mint: t.mint }, opts] },
  ]);
  const source = (mine?.value || []).find((a) => balanceOf(a) >= amount);
  if (!source) throw new ApiError(409, 'Not enough of this coin in the wallet.');
  const dest = (ours?.value || [])[0];
  if (!dest?.pubkey) throw new ApiError(503, 'This coin is not available right now.');
  return unsignedTx(tokenMessage({ owner: from, source: source.pubkey, dest: dest.pubkey, mint: t.mint, amount, decimals: t.decimals, blockhash }));
}

export async function solTransferTx(ref, from) {
  const inv = (await q('SELECT network, asset, address, expected_atomic::text AS expected_atomic, status, expires_at FROM invoices WHERE ref = $1', [String(ref)])).rows[0];
  let client;
  const lazy = () => (client ??= rpcClient({ urls: config().sol.rpc }));
  return buildSolTx(inv, from, { call: (...a) => lazy().call(...a), batch: (...a) => lazy().batch(...a) });
}
