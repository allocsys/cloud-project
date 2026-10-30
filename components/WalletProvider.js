'use client';
// The wallet connection (WalletConnect, EVM) kept for the whole signed-in app: the header pill and the pay screen share it.
// connect() asks the wallet for the account only; send() asks the connected wallet for one transfer (switching its chain first when needed).
// A connection is remembered (flag vtx-wc) so a reload picks the session up again; people who never connected do not load the wallet code.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useApi } from '@/lib/api';
import { WC_CHAINS } from '@/lib/wc-tx';

const FLAG = 'vtx-wc';
const Ctx = createContext(null);

const meta = () => ({ name: 'Vertexhash', description: 'Vertexhash', url: window.location.origin, icons: [`${window.location.origin}/icons/192`] });
const refused = (e) => /reject|denied|declin|cancel|closed/i.test(String(e?.message || e));
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
        // A session left from before could be on another chain or account: always start clean.
        if (p.session) await p.disconnect().catch(() => {});
        try {
          mark('connecting');
          try {
            await p.connect();
          } catch (e) {
            // One more try on a slow link, but not when the buyer closed or refused it.
            if (refused(e)) throw e;
            mark('retrying');
            await new Promise((r) => setTimeout(r, 1500));
            await p.connect();
          }
          if (!p.accounts?.[0]) throw new Error('no account');
        } catch (e) {
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
    setAcct('');
    setChainId(0);
    remember(false);
    if (p) await p.disconnect().catch(() => {});
  }, []);

  // Step 2: ask the connected wallet for the transfer. The wallet app is behind the browser, so it is opened to bring the request forward.
  const send = useCallback(async (tx, mark = () => {}, open = () => {}) => {
    const p = live.current;
    const from = p?.accounts?.[0];
    if (!p || !from) throw new Error('not connected');
    setBusy(true);
    try {
      if (Number(p.chainId) !== tx.chainId) {
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
      const req = p.request({ method: 'eth_sendTransaction', params: [{ from, to: tx.to, value: tx.value, data: tx.data }] });
      req.catch(() => {});
      const link = p.session?.peer?.metadata?.redirect?.native;
      if (link) setTimeout(() => open(link), 700);
      // Do not wait forever if the wallet never answers.
      return await Promise.race([req, new Promise((_, rej) => setTimeout(() => rej(new Error('no answer')), 120000))]);
    } finally {
      setBusy(false);
    }
  }, []);

  const value = useMemo(() => ({ enabled: !!pid, acct, chainId, busy, connect, disconnect, send }), [pid, acct, chainId, busy, connect, disconnect, send]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
