// Gateway settings, read from environment variables at the moment they are needed (so tests can change them).
// GATEWAY_DB_NAME     optional. Shared Postgres server: DATABASE_URL points at the server, the gateway creates and uses its own database with this name (read in server.js)
// GATEWAY_DB_USER, GATEWAY_DB_PASSWORD  optional, one-time: with the admin DATABASE_URL, creates a limited login (owns only the gateway database, 16+ char password). Then set DATABASE_URL to that login and remove these three variables.
// GATEWAY_API_SECRET  shared secret the app sends as a Bearer token
// BTC_XPUB            account-level extended PUBLIC key (xpub or zpub). Never a private key or seed. A fresh address per invoice.
// PAY_ADDR_BTC        fixed-address mode: one public BTC address; invoices are told apart by exact amount. Used when BTC_XPUB is not set.
// PAY_ADDR_EVM, PAY_ADDR_TRX, PAY_ADDR_SOL  public receiving addresses (EVM chains share one) for the fixed-address networks.
// EVM_NETWORKS        which EVM networks to accept, comma separated (default eth,bsc,pol). Needs PAY_ADDR_EVM.
// EVM_RPC_ETH, EVM_RPC_BSC, EVM_RPC_POL  JSON-RPC endpoints, comma separated, https only. Tried in order; the next one is used when one fails.
// EVM_CONF_ETH, EVM_CONF_BSC, EVM_CONF_POL  confirmations needed before an EVM payment counts (defaults 12, 15, 64)
// EVM_SCAN_SECONDS    how often each EVM chain is scanned for new blocks (default 15, minimum 3)
// TRON_API_URL      TronGrid-compatible API base, https only (default https://api.trongrid.io)
// TRON_API_KEY        optional TronGrid key (sent as TRON-PRO-API-KEY; raises the rate limit)
// TRX_CONFIRMATIONS   confirmations needed for a TRX payment (default 1; a 'confirmed' Tron payment is already solidified)
// SOL_RPC             Solana JSON-RPC endpoints, comma separated, https only. Tried in order; may carry a provider key in the URL.
// SOL_CONFIRMATIONS   confirmations needed for a SOL payment (default 1; only finalized payments get any)
// BTC_CONFIRMATIONS   confirmations needed before a BTC payment counts (default 1, matching the app)
// BTC_EXPLORER_URL    Esplora-compatible API base, https only (default https://mempool.space/api)
// POLL_SECONDS        how often open invoices are checked on chain (default 30, minimum 5)
// WATCHER             'off' stops this process from watching the chain (default: on when a database and a BTC key or address are set)
// INVOICE_TTL_MINUTES  how long an invoice stays open before it expires (default 10)
// INVOICE_BUFFER_PERCENT  extra added to every invoice amount for fees, commissions and price moves (default 2, 0 to 20)
// EVM_CATCHUP_HOURS   an idle EVM scanner wakes when an invoice opens and reads back at most this many hours (default 6)
// IDLE_POLL_SECONDS   how often the watcher looks for new invoices while none is open (default 60, minimum 5)
// APP_WEBHOOK_URL    where signed payment callbacks go (the app's /api/payments/webhook). https only (http only for localhost).
// GATEWAY_WEBHOOK_SECRET  signs every callback (x-gateway-sig). At least 16 characters. Same value in the app.
// OUTBOX_SECONDS      how often due callbacks are sent (default 10, minimum 1)
// RATE_SOURCE         'coingecko' (default) or 'static' (staging and tests: uses RATE_BTC_USD, or RATE_<ASSET>_USD)
const whole = (v, dflt) => (Number(v) >= 1 ? Math.floor(Number(v)) : dflt);
const text = (v) => String(v || '').trim();
const csv = (v) =>
  text(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

// A percentage from 0 to 20; anything else gives the default.
const pct = (v, dflt) => (text(v) !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 20 ? Number(v) : dflt);

// Public nodes, used until EVM_RPC_<NET> says otherwise.
const EVM_RPC = {
  eth: ['https://ethereum-rpc.publicnode.com', 'https://cloudflare-eth.com'],
  bsc: ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.binance.org'],
  pol: ['https://polygon-bor-rpc.publicnode.com', 'https://polygon-rpc.com'],
};

const SOL_RPC = ['https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com'];

export const config = () => {
  const nets = csv(process.env.EVM_NETWORKS).map((s) => s.toLowerCase());
  const rpc = {};
  for (const n of Object.keys(EVM_RPC)) {
    const own = csv(process.env[`EVM_RPC_${n.toUpperCase()}`]);
    rpc[n] = own.length ? own : EVM_RPC[n];
  }
  return {
    apiSecret: process.env.GATEWAY_API_SECRET || '',
    btcXpub: text(process.env.BTC_XPUB),
    btcConfirmations: whole(process.env.BTC_CONFIRMATIONS, 1),
    btcExplorerUrl: text(process.env.BTC_EXPLORER_URL) || 'https://mempool.space/api',
    payAddr: {
      btc: text(process.env.PAY_ADDR_BTC),
      evm: text(process.env.PAY_ADDR_EVM),
      trx: text(process.env.PAY_ADDR_TRX),
      sol: text(process.env.PAY_ADDR_SOL),
    },
    evm: {
      networks: nets.length ? nets : ['eth', 'bsc', 'pol'],
      rpc,
      confirmations: {
        eth: whole(process.env.EVM_CONF_ETH, 12),
        bsc: whole(process.env.EVM_CONF_BSC, 15),
        pol: whole(process.env.EVM_CONF_POL, 64),
      },
      scanIntervalMs: Math.max(3, whole(process.env.EVM_SCAN_SECONDS, 15)) * 1000,
      catchupMs: whole(process.env.EVM_CATCHUP_HOURS, 6) * 3_600_000,
    },
    trx: {
      apiUrl: text(process.env.TRON_API_URL) || 'https://api.trongrid.io',
      apiKey: text(process.env.TRON_API_KEY),
      confirmations: whole(process.env.TRX_CONFIRMATIONS, 1),
    },
    sol: {
      rpc: csv(process.env.SOL_RPC).length ? csv(process.env.SOL_RPC) : SOL_RPC,
      confirmations: whole(process.env.SOL_CONFIRMATIONS, 1),
    },
    pollIntervalMs: Math.max(5, whole(process.env.POLL_SECONDS, 30)) * 1000,
    idlePollMs: Math.max(5, whole(process.env.IDLE_POLL_SECONDS, 60)) * 1000,
    watcherEnabled: process.env.WATCHER !== 'off',
    invoiceTtlMs: (Number(process.env.INVOICE_TTL_MINUTES) > 0 ? Number(process.env.INVOICE_TTL_MINUTES) : 10) * 60_000,
    invoiceBufferPct: pct(process.env.INVOICE_BUFFER_PERCENT, 2),
    appWebhookUrl: text(process.env.APP_WEBHOOK_URL),
    webhookSecret: process.env.GATEWAY_WEBHOOK_SECRET || '',
    outboxIntervalMs: whole(process.env.OUTBOX_SECONDS, 10) * 1000,
    rateSource: process.env.RATE_SOURCE === 'static' ? 'static' : 'coingecko',
    staticBtcUsd: Number(process.env.RATE_BTC_USD) || 0,
  };
};
