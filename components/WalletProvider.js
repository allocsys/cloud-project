'use client';
// The wallet connection (WalletConnect, EVM) kept for the whole signed-in app: the header pill and the pay screen share it.
// Uses the standalone WalletConnect client (same path as the working WalletConnect demo). connect() opens the wallet with the
// connection request and waits for its approval; send() asks the connected wallet for one transfer.
// A connection is remembered (flag vtx-wc) so a reload picks the session up again; people who never connected do not load the wallet code.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useApi } from '@/lib/api';
import { WC_CHAINS } from '@/lib/wc-tx';

const FLAG = 'vtx-wc';
const Ctx = createContext(null);

const meta = () => ({ name: 'Vertexhash', description: 'Vertexhash', url: window.location.origin, icons: [`${window.location.origin}/icons/192`] });
const remember = (on) => {
  try {
    if (on) localStorage.setItem(FLAG, '1');
    else localStorage.removeItem(FLAG);
  } catch {}
};

// Chains are CAIP-2 ids ('eip155:1'). The first is required, the rest are optional.
const MAIN = 'eip155:1';
const OPTIONAL = WC_CHAINS.filter((c) => c !== 1).map((c) => `eip155:${c}`);
const METHODS = ['eth_sendTransaction', 'eth_accounts', 'personal_sign'];
const EVENTS = ['chainChanged', 'accountsChanged'];
const USER_OUT = { code: 6000, message: 'USER_DISCONNECTED' };

// Telegram's in-app browser blocks a page that navigates to a wc: link (net::ERR_UNKNOWN_URL_SCHEME), so there WalletConnect's wallet picker (https links) is used instead.
const inTelegram = () => /Telegram/i.test(navigator.userAgent || '') || !!window.TelegramWebviewProxy;

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
  const [acct, setAcct] = useState('');
  const [chainId, setChainId] = useState(0);
  const [busy, setBusy] = useState(false);

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
    if (!pid || live.current) return undefined;
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
  }, [pid, getClient, adopt]);

  // Step 1: connect (no payment request). `projectId` is the order's own id, used when the config has not arrived yet.
  const connect = useCallback(
    async ({ projectId, mark = () => {} } = {}) => {
      if (live.current?.acct) return live.current.acct;
      const id = pid || projectId;
      if (!id) throw new Error('no project id');
      setBusy(true);
      let modal = null;
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
        const tg = inTelegram();
        if (uri) {
          if (tg) {
            // Telegram: WalletConnect's wallet picker opens the wallet with https links, which Telegram allows.
            const { WalletConnectModal } = await import('@walletconnect/modal');
            modal = new WalletConnectModal({ projectId: id, chains: WC_CHAINS.map((c) => `eip155:${c}`) });
            modal.openModal({ uri }).catch(() => {});
          } else window.location.href = uri;
        }
        let timer;
        const session = await Promise.race([
          approval(),
          new Promise((_, rej) => {
            timer = setTimeout(() => rej(new Error('Wallet did not answer')), tg ? 180000 : 60000);
          }),
        ]).finally(() => clearTimeout(timer));
        const a = adopt(client, session);
        if (!a) throw new Error('no account');
        remember(true);
        return a;
      } catch (e) {
        throw e;
      } finally {
        try {
          modal?.closeModal();
        } catch {}
        setBusy(false);
      }
    },
    [pid, getClient, adopt]
  );

  const disconnect = useCallback(async () => {
    const cur = live.current;
    live.current = null;
    pending.current = null;
    setAcct('');
    setChainId(0);
    remember(false);
    if (cur) await cur.client.disconnect({ topic: cur.topic, reason: USER_OUT }).catch(() => {});
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

  const value = useMemo(() => ({ enabled: !!pid, acct, chainId, busy, connect, disconnect, send }), [pid, acct, chainId, busy, connect, disconnect, send]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
