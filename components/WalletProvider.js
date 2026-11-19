'use client';
// The wallet connection (WalletConnect, EVM) kept for the whole signed-in app: the header pill and the pay screen share it.
// connect() asks the wallet for the account only; send() asks the connected wallet for one transfer (switching its chain first when needed).
// A connection is remembered (flag vtx-wc) so a reload picks the session up again; people who never connected do not load the wallet code.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useApi } from '@/lib/api';
import { WC_CHAINS } from '@/lib/wc-tx';

const FLAG = 'vtx-wc';

// Debug: send one stage line to the server log (see /api/debug/client-error).
const dbg = (text) => {
  try {
    fetch('/api/debug/client-error', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: `stage: ${text}` }), keepalive: true }).catch(() => {});
  } catch {}
};
const Ctx = createContext(null);

const meta = () => ({ name: 'Vertexhash', description: 'Vertexhash', url: window.location.origin, icons: [`${window.location.origin}/icons/192`] });
const remember = (on) => {
  try {
    if (on) localStorage.setItem(FLAG, '1');
    else localStorage.removeItem(FLAG);
  } catch {}
};

async function initProvider(projectId) {
  const { EthereumProvider } = await import('@walletconnect/ethereum-provider');
  return EthereumProvider.init({ projectId, chains: [1], optionalChains: WC_CHAINS, showQrModal: true, metadata: meta() });
}

export function useWallet() {
  return useContext(Ctx);
}

export default function WalletProvider({ children }) {
  const { data: cfg } = useApi('/api/wc', { ttl: 3600000 });
  const pid = cfg?.id || '';
  const live = useRef(null); // the connected provider
  const pending = useRef(null); // the transfer request the wallet has not answered yet: { sig, req, late }
  const [acct, setAcct] = useState('');
  const [chainId, setChainId] = useState(0);
  const [busy, setBusy] = useState(false);

  const attach = useCallback((p) => {
    live.current = p;
    const sync = () => {
      setAcct(p.accounts?.[0] || '');
      setChainId(Number(p.chainId) || 0);
    };
    p.on('accountsChanged', sync);
    p.on('chainChanged', sync);
    p.on('disconnect', () => {
      if (live.current !== p) return;
      live.current = null;
      setAcct('');
      setChainId(0);
      remember(false);
    });
    sync();
  }, []);

  // A reload: pick up the saved session, only for someone who connected before.
  useEffect(() => {
    if (!pid || live.current) return undefined;
    let flag = '';
    try {
      flag = localStorage.getItem(FLAG) || '';
    } catch {}
    if (!flag) return undefined;
    let off = false;
    (async () => {
      try {
        const p = await initProvider(pid);
        if (off || live.current) return;
        if (p.session && p.accounts?.[0]) attach(p);
        else remember(false);
      } catch {}
    })();
    return () => {
      off = true;
    };
  }, [pid, attach]);

  // Step 1: connect (no payment request). `projectId` is the order's own id, used when the config has not arrived yet.
  const connect = useCallback(
    async ({ chainId: want, projectId, mark = () => {} } = {}) => {
      if (live.current?.accounts?.[0]) return live.current.accounts[0];
      const id = pid || projectId;
      if (!id) throw new Error('no project id');
      setBusy(true);
      try {
        mark('loading');
        const p = await initProvider(id);
        mark('init');
        dbg('init ok');
        p.on('display_uri', () => dbg('uri shown'));
        p.on('connect', () => dbg('connect event'));
        p.on('session_delete', () => dbg('session deleted by wallet'));
        p.on('disconnect', () => dbg('disconnect event'));
        // A session left from before could be on another chain or account: always start clean.
        if (p.session) await p.disconnect().catch(() => {});
        try {
          mark('connecting');
          let timer;
          await Promise.race([
            p.connect(),
            new Promise((_, rej) => {
              timer = setTimeout(() => rej(new Error('Wallet did not answer')), 60000);
            }),
          ]).finally(() => clearTimeout(timer));
          dbg('connect resolved');
          if (!p.accounts?.[0]) throw new Error('no account');
        } catch (e) {
          dbg(`connect failed: ${e?.message || e}`);
          p.disconnect().catch(() => {});
          throw e;
        }
        attach(p);
        remember(true);
        return p.accounts[0];
      } finally {
        setBusy(false);
      }
    },
    [pid, attach]
  );

  const disconnect = useCallback(async () => {
    const p = live.current;
    live.current = null;
    pending.current = null;
    setAcct('');
    setChainId(0);
    remember(false);
    if (p) await p.disconnect().catch(() => {});
  }, []);

  // Step 2: ask the connected wallet for the transfer. The wallet app is behind the browser, so it is opened to bring the request forward.
  // `late(hash)` is called if the wallet answers only after "no answer" was thrown: the person may still approve it a few minutes later,
  // and then the money does go out. A tap on Send again while that request is still open asks nothing new: it waits for the same one.
  const send = useCallback(async (tx, mark = () => {}, open = () => {}, late = null) => {
    const p = live.current;
    const from = p?.accounts?.[0];
    if (!p || !from) throw new Error('not connected');
    const sig = [from, tx.chainId, tx.to, tx.value, tx.data].join('|');
    const again = pending.current?.sig === sig ? pending.current : null;
    setBusy(true);
    try {
      if (!again && Number(p.chainId) !== tx.chainId) {
        mark('switching');
        try {
          // A wallet that never answers the switch must not block the payment request.
          await Promise.race([
            p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${tx.chainId.toString(16)}` }] }),
            new Promise((r) => setTimeout(r, 4000)),
          ]);
        } catch {}
        if (Number(p.chainId) !== tx.chainId) throw new Error('wrong network');
      }
      mark('sending');
      let entry = again;
      if (!entry) {
        const req = p.request({ method: 'eth_sendTransaction', params: [{ from, to: tx.to, value: tx.value, data: tx.data }] });
        entry = { sig, req, late: false };
        pending.current = entry;
        const clear = () => {
          if (pending.current === entry) pending.current = null;
        };
        req.then(clear, clear);
      }
      const { req } = entry;
      const link = p.session?.peer?.metadata?.redirect?.native;
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

  const value = useMemo(() => ({ enabled: !!pid, acct, chainId, busy, connect, disconnect, send }), [pid, acct, chainId, busy, connect, disconnect, send]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
