'use client';
import { useState } from 'react';
import { useMined } from '@/lib/useMined';
import { history as seed, DEPOSIT_ADDRESS, MIN_WITHDRAW } from '@/lib/data';
import { useToast } from '@/components/Toast';

export default function Wallet() {
  const mined = useMined();
  const [withdrawn, setWithdrawn] = useState(0);
  const [tab, setTab] = useState('withdraw');
  const [amount, setAmount] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');
  const [history, setHistory] = useState(seed);
  const [toast, show] = useToast();
  const available = mined - withdrawn;

  // TODO: call your withdrawal API here.
  function withdraw() {
    const a = parseFloat(amount);
    if (!(a > 0)) return setError('Enter an amount to withdraw.');
    if (a < MIN_WITHDRAW) return setError(`Minimum withdrawal is ${MIN_WITHDRAW} BTC.`);
    if (a > available) return setError('Amount is more than your available balance.');
    if (!/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,60}$/.test(address.trim())) return setError('Enter a valid Bitcoin address.');
    setError('');
    setWithdrawn(withdrawn + a);
    setHistory([{ label: 'Withdrawal', date: 'Today', amount: `-${a.toFixed(4)}` }, ...history]);
    setAmount('');
    setAddress('');
    show('Withdrawal requested');
  }

  function copy() {
    navigator.clipboard?.writeText(DEPOSIT_ADDRESS);
    show('Address copied');
  }

  return (
    <>
      <div className="top"><h2>Wallet</h2></div>
      <div className="grid">
        <div className="card hero">
          <span className="mute">Available balance</span>
          <div className="big">{available.toFixed(8)}<small>BTC</small></div>
          <span className="mute">Minimum withdrawal {MIN_WITHDRAW} BTC</span>
        </div>
        <div className="grid wal">
          <div className="card">
            <div className="tabs" role="group" aria-label="Wallet action">
              <button aria-pressed={tab === 'withdraw'} onClick={() => setTab('withdraw')}>Withdraw</button>
              <button aria-pressed={tab === 'deposit'} onClick={() => setTab('deposit')}>Deposit</button>
            </div>
            {tab === 'withdraw' ? (
              <div>
                <label htmlFor="wa">Amount (BTC)</label>
                <div className="fieldrow">
                  <input id="wa" inputMode="decimal" placeholder="0.00000000" value={amount} onChange={(e) => setAmount(e.target.value)} />
                  <button className="btn ghost" onClick={() => setAmount(available.toFixed(8))}>Max</button>
                </div>
                <label htmlFor="wd">Bitcoin address</label>
                <input id="wd" placeholder="bc1q…" value={address} onChange={(e) => setAddress(e.target.value)} />
                <div className="err" role="alert">{error}</div>
                <button className="btn" onClick={withdraw}>Withdraw</button>
              </div>
            ) : (
              <div>
                <p className="mute">Send BTC to this address to fund plan purchases.</p>
                <div className="addr">{DEPOSIT_ADDRESS}</div>
                <button className="btn ghost" onClick={copy}>Copy address</button>
              </div>
            )}
          </div>
          <div className="card">
            <h3>History</h3>
            {history.map((h, i) => (
              <div key={i} className="row">
                <div>{h.label}<small>{h.date}</small></div>
                <b className={h.amount.startsWith('+') ? 'up' : ''}>{h.amount}</b>
              </div>
            ))}
          </div>
        </div>
      </div>
      {toast}
    </>
  );
}
