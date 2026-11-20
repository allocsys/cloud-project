'use client';
// The wallet connection (WalletConnect, EVM) kept for the whole signed-in app: the header pill and the pay screen share it.
// Uses the standalone WalletConnect client (same path as the working WalletConnect demo). connect() opens the wallet with the
// connection request and waits for its approval; send() asks the connected wallet for one transfer.
// A connection is remembered (flag vtx-wc) so a reload picks the session up again; people who never connected do not load the wallet code.
// Inside Telegram the wc: links are blocked, so there the wallet is Tonkeeper over TON Connect (TON only, flag vtx-tc): connect() opens
// Tonkeeper with the request, sendTon() asks it for one transfer. The site and the PWA keep WalletConnect.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useApi } from '@/lib/api';
import { telegramReady } from '@/lib/telegram';
import { WC_CHAINS } from '@/lib/wc-tx';

const FLAG = 'vtx-wc';
const TON_FLAG = 'vtx-tc';
// Tonkeeper's TON Connect link and bridge (fixed values from the wallets list, so no list is fetched). Main network only.
const TK = { universalLink: 'https://app.tonkeeper.com/ton-connect', bridgeUrl: 'https://bridge.tonapi.io/bridge' };
const MAINNET = '-239';
const inTg = () => typeof window !== 'undefined' && !!window.Telegram?.WebApp?.initData;
const Ctx = createContext(null);

const meta = () => ({ name: 'Vertexhash', description: 'Vertexhash', url: window.location.origin, icons: [`${window.location.origin}/icons/192`] });
const remember = (on, flag = FLAG) => {
  try {
    if (on) localStorage.setItem(flag, '1');
    else localStorage.removeItem(flag);
  } catch {}
};

// Chains are CAIP-2 ids ('eip155:1'). The first is required, the rest are optional.
const MAIN = 'eip155:1';
const OPTIONAL = WC_CHAINS.filter((c) => c !== 1).map((c) => `eip155:${c}`);
const METHODS = ['eth_sendTransaction', 'eth_accounts', 'personal_sign'];
const EVENTS = ['chainChanged', 'accountsChanged'];
const USER_OUT = { code: 6000, message: 'USER_DISCONNECTED' };

async function initClient(projectId) {
  const { SignClient } = await import('@walletconnect/sign-client');
  return SignClient.init({ projectId, metadata: meta() });
}

// The account and chain of a session, from 'eip155:<chain>:<address>'.
function fromSession(session) {
  const first = session?.namespaces?.eip155?.accounts?.[0] || '';
  const [, chain, acct] = first.split(':');
  return { acct: acct || '', chain: Number(chain) || 0 };
}

export function useWallet() {
  return useContext(Ctx);
}

export default function WalletProvider({ children }) {
  const { data: cfg } = useApi('/api/wc', { ttl: 3600000 });
  const pid = cfg?.id || '';
  const live = useRef(null); // { client, topic, session, acct, chain } while connected
  const clientP = useRef(null); // one client for the page: the reload pick-up and connect share it
  const pending = useRef(null); // the transfer request the wallet has not answered yet: { sig, req, late }
  const tonP = useRef(null); // the TON Connect client (Telegram only), loaded on first use
  const tonLive = useRef(null); // { acct } while Tonkeeper is connected
  const tonPending = useRef(null); // the TON transfer the wallet has not answered yet: { sig, req, late }
  const tonConnecting = useRef(null); // the connect that is running: a second tap joins it, it does not send a second request
  const [acct, setAcct] = useState('');
  const [chainId, setChainId] = useState(0);
  const [busy, setBusy] = useState(false);
  const [tg, setTg] = useState(false); // opened inside Telegram: the wallet is Tonkeeper (TON Connect)

  useEffect(() => {
    let off = false;
    telegramReady(10000).then((w) => {
      if (!off && w?.initData) setTg(true);
    });
    return () => {
      off = true;
    };
  }, []);

  const getTon = useCallback(() => {
    if (!tonP.current) {
      tonP.current = import('@tonconnect/sdk')
        .then(({ TonConnect, toUserFriendlyAddress }) => {
          const c = new TonConnect({ manifestUrl: `${window.location.origin}/tonconnect-manifest.json` });
          c.onStatusChange((w) => {
            const a = w?.account;
            if (a && String(a.chain) === MAINNET) {
              const friendly = toUserFriendlyAddress(a.address);
              tonLive.current = { acct: friendly };
              setAcct(friendly);
              setChainId(0);
              remember(true, TON_FLAG);
              return;
            }
            if (a) c.disconnect().catch(() => {}); // a test network wallet is not accepted
            tonLive.current = null;
            setAcct('');
            remember(false, TON_FLAG);
          });
          return c;
        })
        .catch((e) => {
          tonP.current = null;
          throw e;
        });
    }
    return tonP.current;
  }, []);

  const getClient = useCallback((id) => {
    if (!clientP.current) {
      clientP.current = initClient(id)
        .then((client) => {
          const gone = ({ topic }) => {
            if (live.current?.topic !== topic) return;
            live.current = null;
            setAcct('');
            setChainId(0);
            remember(false);
          };
          client.on('session_delete', gone);
          client.on('session_expire', gone);
          return client;
        })
        .catch((e) => {
          clientP.current = null;
          throw e;
        });
    }
    return clientP.current;
  }, []);

  const adopt = useCallback((client, session) => {
    const { acct: a, chain } = fromSession(session);
    live.current = { client, topic: session.topic, session, acct: a, chain };
    setAcct(a);
    setChainId(chain);
    return a;
  }, []);

  // A reload: pick up the saved session, only for someone who connected before.
  useEffect(() => {
    if (!pid || live.current || tg) return undefined;
    let flag = '';
    try {
      flag = localStorage.getItem(FLAG) || '';
    } catch {}
    if (!flag) return undefined;
    let off = false;
    (async () => {
      try {
        const client = await getClient(pid);
        const s = client.session.getAll()[0];
        if (off || live.current) return;
        if (s && fromSession(s).acct) adopt(client, s);
        else remember(false);
      } catch {}
    })();
    return () => {
      off = true;
    };
  }, [pid, tg, getClient, adopt]);

  // A reload inside Telegram: pick up the Tonkeeper session (also a connect that was still waiting when the app was put away).
  useEffect(() => {
    if (!tg || tonLive.current) return undefined;
    let known = '';
    try {
      known = localStorage.getItem(TON_FLAG) || localStorage.getItem('ton-connect-storage_bridge-connection') || '';
    } catch {}
    if (!known) return undefined;
    let off = false;
    (async () => {
      try {
        const c = await getTon();
        if (!off) await c.restoreConnection();
      } catch {}
    })();
    return () => {
      off = true;
    };
  }, [tg, getTon]);

  // Step 1: connect (no payment request). `projectId` is the order's own id, used when the config has not arrived yet.
  const connectEvm = useCallback(
    async ({ projectId, mark = () => {} } = {}) => {
      if (live.current?.acct) return live.current.acct;
      const id = pid || projectId;
      if (!id) throw new Error('no project id');
      setBusy(true);
      try {
        mark('loading');
        const client = await getClient(id);
        mark('init');
        // A session left from before is closed first, so the new request starts clean.
        for (const s of client.session.getAll()) await client.disconnect({ topic: s.topic, reason: USER_OUT }).catch(() => {});
        mark('connecting');
        const { uri, approval } = await client.connect({
          requiredNamespaces: { eip155: { methods: METHODS, chains: [MAIN], events: EVENTS } },
          optionalNamespaces: { eip155: { methods: METHODS, chains: OPTIONAL, events: EVENTS } },
        });
        // Open the wallet app with the request. The approval below waits for the wallet's answer.
        if (uri) window.location.href = uri;
        let timer;
        const session = await Promise.race([
          approval(),
          new Promise((_, rej) => {
            timer = setTimeout(() => rej(new Error('Wallet did not answer')), 60000);
          }),
        ]).finally(() => clearTimeout(timer));
        const a = adopt(client, session);
        if (!a) throw new Error('no account');
        remember(true);
        return a;
      } finally {
        setBusy(false);
      }
    },
    [pid, getClient, adopt]
  );

  // Telegram: open Tonkeeper with the connect request and wait for its answer (the Mini App stays open behind it).
  const runTon = useCallback(
    async ({ mark = () => {} } = {}) => {
      if (tonLive.current?.acct) return tonLive.current.acct;
      setBusy(true);
      let off = () => {};
      let timer;
      try {
        mark('loading');
        const c = await getTon();
        if (c.connected) await c.disconnect().catch(() => {});
        mark('connecting');
        const answered = new Promise((res, rej) => {
          off = c.onStatusChange((w) => w?.account && res(), rej);
        });
        const link = c.connect(TK);
        const w = window.Telegram?.WebApp;
        if (w?.openLink) w.openLink(link);
        else window.location.href = link;
        await Promise.race([
          answered,
          new Promise((_, rej) => {
            timer = setTimeout(() => rej(new Error('Wallet did not answer')), 120000);
          }),
        ]);
        const a = tonLive.current?.acct;
        if (!a) throw new Error('no account');
        return a;
      } finally {
        off();
        clearTimeout(timer);
        setBusy(false);
      }
    },
    [getTon]
  );

  const connectTon = useCallback(
    (opts) => {
      if (tonConnecting.current) return tonConnecting.current;
      const p = runTon(opts).finally(() => {
        if (tonConnecting.current === p) tonConnecting.current = null;
      });
      tonConnecting.current = p;
      return p;
    },
    [runTon]
  );

  const connect = useCallback((opts) => (inTg() ? connectTon(opts) : connectEvm(opts)), [connectTon, connectEvm]);

  const disconnect = useCallback(async () => {
    const cur = live.current;
    const ton = tonLive.current;
    live.current = null;
    pending.current = null;
    tonLive.current = null;
    tonPending.current = null;
    setAcct('');
    setChainId(0);
    remember(false);
    remember(false, TON_FLAG);
    if (cur) await cur.client.disconnect({ topic: cur.topic, reason: USER_OUT }).catch(() => {});
    if (ton) {
      const c = await tonP.current?.catch(() => null);
      if (c?.connected) await c.disconnect().catch(() => {});
    }
  }, []);

  // Step 2: ask the connected wallet for the transfer. The wallet app is behind the browser, so it is opened to bring the request forward.
  // `late(hash)` is called if the wallet answers only after "no answer" was thrown: the person may still approve it a few minutes later,
  // and then the money does go out. A tap on Send again while that request is still open asks nothing new: it waits for the same one.
  const send = useCallback(async (tx, mark = () => {}, open = () => {}, late = null) => {
    const cur = live.current;
    if (!cur?.acct) throw new Error('not connected');
    const from = cur.acct;
    const sig = [from, tx.chainId, tx.to, tx.value, tx.data].join('|');
    const again = pending.current?.sig === sig ? pending.current : null;
    setBusy(true);
    try {
      mark('sending');
      let entry = again;
      if (!entry) {
        const req = cur.client.request({
          topic: cur.topic,
          chainId: `eip155:${tx.chainId}`,
          request: { method: 'eth_sendTransaction', params: [{ from, to: tx.to, value: tx.value, data: tx.data }] },
        });
        entry = { sig, req, late: false };
        pending.current = entry;
        const clear = () => {
          if (pending.current === entry) pending.current = null;
        };
        req.then(clear, clear);
      }
      const { req } = entry;
      const link = cur.session?.peer?.metadata?.redirect?.native;
      if (link) setTimeout(() => open(link), 700);
      // Do not wait forever if the wallet never answers.
      let timer;
      try {
        return await Promise.race([
          req,
          new Promise((_, rej) => {
            timer = setTimeout(() => rej(new Error('no answer')), 120000);
          }),
        ]);
      } catch (e) {
        if (/no answer/.test(String(e?.message)) && late && !entry.late) {
          entry.late = true;
          req.then(late, () => {});
        }
        throw e;
      } finally {
        clearTimeout(timer);
      }
    } finally {
      setBusy(false);
    }
  }, []);

  // Telegram: ask Tonkeeper for one TON transfer, { to, amount (nanoton) } from lib/ton-tx.js. Same rules as send(): a tap on Send again while
  // the request is open waits for the same one, and `late(boc)` is called if the wallet answers only after "no answer" was thrown.
  const sendTon = useCallback(async (tx, mark = () => {}, late = null) => {
    if (!tonLive.current?.acct) throw new Error('not connected');
    const sig = `${tx.to}|${tx.amount}`;
    const again = tonPending.current?.sig === sig ? tonPending.current : null;
    // The wallet app is behind the Mini App: open it to bring the request forward.
    const bring = () => {
      const w = window.Telegram?.WebApp;
      if (w?.openLink) setTimeout(() => w.openLink(TK.universalLink), 500);
    };
    setBusy(true);
    try {
      mark('sending');
      const c = await getTon();
      let entry = again;
      if (!entry) {
        const req = c.sendTransaction(
          { validUntil: Math.floor(Date.now() / 1000) + 600, network: MAINNET, messages: [{ address: tx.to, amount: tx.amount }] },
          { onRequestSent: bring }
        );
        entry = { sig, req, late: false };
        tonPending.current = entry;
        const clear = () => {
          if (tonPending.current === entry) tonPending.current = null;
        };
        req.then(clear, clear);
      } else bring();
      const { req } = entry;
      let timer;
      try {
        return await Promise.race([
          req,
          new Promise((_, rej) => {
            timer = setTimeout(() => rej(new Error('no answer')), 120000);
          }),
        ]);
      } catch (e) {
        if (/no answer/.test(String(e?.message)) && late && !entry.late) {
          entry.late = true;
          req.then(late, () => {});
        }
        throw e;
      } finally {
        clearTimeout(timer);
      }
    } finally {
      setBusy(false);
    }
  }, [getTon]);

  const value = useMemo(
    () => ({ enabled: tg || !!pid, tg, acct, chainId, busy, connect, disconnect, send, sendTon }),
    [pid, tg, acct, chainId, busy, connect, disconnect, send, sendTon]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
