// Turns the gateway's EIP-681 payment link into a transaction a wallet can be asked to send (Connect wallet).
// Native coin: 'ethereum:<to>@<chain>?value=<wei>'. Token: 'ethereum:<contract>@<chain>/transfer?address=<to>&uint256=<atomic>'.
// Returns { chainId, to, value, data } (hex strings), or null when the link is not one of these or the chain is not supported.
export const WC_CHAINS = [1, 56, 137];

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const INT = /^[1-9]\d*$/;

export function evmTx(uri) {
  const m = /^ethereum:(0x[0-9a-fA-F]{40})@(\d+)(\/transfer)?\?(.+)$/.exec(String(uri || ''));
  if (!m) return null;
  const chainId = Number(m[2]);
  if (!WC_CHAINS.includes(chainId)) return null;
  const q = new URLSearchParams(m[4]);
  if (!m[3]) {
    const v = q.get('value') || '';
    return INT.test(v) ? { chainId, to: m[1], value: `0x${BigInt(v).toString(16)}`, data: '0x' } : null;
  }
  const to = q.get('address') || '';
  const n = q.get('uint256') || '';
  if (!ADDR.test(to) || !INT.test(n)) return null;
  // ERC-20 transfer(address,uint256): selector a9059cbb, then both arguments padded to 32 bytes.
  const data = `0xa9059cbb${to.slice(2).toLowerCase().padStart(64, '0')}${BigInt(n).toString(16).padStart(64, '0')}`;
  return { chainId, to: m[1], value: '0x0', data };
}
