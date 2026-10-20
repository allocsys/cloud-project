'use client';
import Link from 'next/link';
import { halls as defaultHalls, MIN_WITHDRAW, MIN_WITHDRAW_USD } from '@/lib/data';
import { ASSETS, NETWORKS, SWAP_FEE_PCT } from '@/lib/assets';
import { hallRates, MAINT_PER_TH_DAY } from '@/lib/fees';
import { useApi } from '@/lib/api';

const h2 = { fontSize: '16px', margin: '22px 0 6px' };
const row = { display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '6px 0', fontSize: '13.5px' };

// Terms: what you pay and how a plan works. Fee numbers are read from the same data the app uses.
export default function Terms() {
  const { data: cat } = useApi('/api/plans', { ttl: 60000 });
  const halls = cat?.halls || defaultHalls;
  const hallList = Object.values(halls).map((h) => ({ h, r: hallRates(h) })).filter((x) => x.r);
  const coinRows = Object.entries(ASSETS).flatMap(([, a]) => Object.entries(a.nets).map(([net, fee]) => ({ k: `${a.sym}-${net}`, label: `${a.sym} on ${NETWORKS[net].short}`, fee: `${fee} ${a.sym}` })));

  return (
    <section id="auth">
      <div className="authbox" style={{ textAlign: 'left', maxWidth: '560px' }}>
        <h1>Terms</h1>
        <p className="mute">What you pay, what comes out of your mining, and how a plan works.</p>

        <h2 style={h2}>1. What you pay for a plan</h2>
        <p className="mute">The price shown as Total due when you choose a plan is the full charge. There is no setup, activation or management fee on top of it.</p>

        <h2 style={h2}>2. Electricity and maintenance</h2>
        <p className="mute">
          These are the costs of running the machines. We do not bill them to you. They are taken out of what your miners produce before your daily payout, so the daily figure you see is already after them. The plan screen shows the amount for the plan you pick.
        </p>
        <div>
          {hallList.map(({ h, r }) => (
            <div key={h.name} style={row}>
              <span>{h.name}</span>
              <span style={{ textAlign: 'right' }}>
                electricity ${r.elec.toFixed(4)}
                <br />
                maintenance ${MAINT_PER_TH_DAY.toFixed(3)}
              </span>
            </div>
          ))}
        </div>
        <p className="fine">Per TH/s per day, in USD. Electricity is the hall&apos;s efficiency in J/TH, times 24 hours, times its power price per kWh. Figures are rounded.</p>
        <p className="mute">These rates are fixed for the whole term of a plan you have bought. If power or running costs rise later, you do not pay more for a plan you already own.</p>

        <h2 style={h2}>3. Plan term, renewal and refunds</h2>
        <p className="mute">
          A plan runs for the term shown when you buy it and then ends. It does not renew by itself; buying again is always your choice. You cannot cancel a plan early or sell it on, and it keeps mining until the term ends.
        </p>
        <p className="mute">
          You can ask for a full refund within 24 hours of buying, as long as the miner has not paid out yet (the first payout day ends at 00:00 UTC, so ask before then). The price goes back to your balance, in BTC at the rate on the day of the refund, and the miner is removed. After that, purchases are not refunded, because the hash power is already working for you. Where the law of your country gives you a longer right to cancel, that right applies.
        </p>
        <p className="mute">If a machine fails or a hall goes offline, we move your hash power to another machine. If we cannot, the days lost are added to the end of your term.</p>

        <h2 style={h2}>4. Deposits and withdrawals</h2>
        <p className="mute">
          Bitcoin has no swap fee. Any other coin pays a {SWAP_FEE_PCT}% swap fee on its dollar value, on deposits (which are credited as BTC) and on withdrawals. A withdrawal also pays a flat network fee, which depends on the coin and network. The minimum withdrawal is ${MIN_WITHDRAW_USD} worth of coin, but we do not recommend withdrawing so little: the flat network fee takes a large share of a small amount. The amount you receive is shown before you confirm.
        </p>
        <div>
          {coinRows.map((c) => (
            <div key={c.k} style={row}>
              <span>{c.label}</span>
              <span>{c.fee}</span>
            </div>
          ))}
        </div>
        <p className="fine">Network fee per withdrawal. Sending crypto to us also costs a network fee, which you pay from your own wallet to the network.</p>
        <p className="mute">Withdrawals are checked by our team before they are paid, so they are not instant. A withdrawal can be held while we check your identity or look into suspected fraud.</p>

        <h2 style={h2}>5. Estimates and risk</h2>
        <p className="mute">Daily figures are estimates. Real payouts follow the BTC price and network difficulty, so they can be higher or lower. Returns are not guaranteed, cloud mining carries risk, and you can lose money. Only use funds you can afford to lose. Nothing here is financial advice.</p>

        <h2 style={h2}>6. Changes to these terms</h2>
        <p className="mute">If we change these terms or any fee, we tell you before it takes effect. A change applies only to plans bought after it. A plan you already own keeps the terms it was bought under.</p>

        <h2 style={h2}>7. Your account</h2>
        <p className="mute">You must be 18 or older and keep one account. Keep your password and two-factor codes to yourself, and turn on two-factor in Settings. We do not accept accounts from places where we cannot legally operate.</p>
        <p className="mute">You can close your account yourself in Settings at any time. Withdraw your balance first: a balance of {MIN_WITHDRAW} BTC or more, a withdrawal or a payment that is not finished yet blocks closing. A smaller balance cannot be paid out and is given up, and any running miners end with no refund. A closed account cannot be reopened; you can sign up again, but you start from nothing.</p>

        <h2 style={h2}>8. Nothing else is charged</h2>
        <p className="mute">A charge that is not listed on this page is not made. If a fee ever applies, it is shown before you confirm.</p>

        <div style={{ height: '14px' }} />
        <Link className="btn" href="/login" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>Back</Link>
      </div>
    </section>
  );
}
