'use client';
import Link from 'next/link';
import { halls as defaultHalls, MIN_WITHDRAW } from '@/lib/data';
import { ASSETS, NETWORKS, SWAP_FEE_PCT } from '@/lib/assets';
import { hallRates, MAINT_PER_TH_DAY } from '@/lib/fees';
import { useApi } from '@/lib/api';

const h2 = { fontSize: '16px', margin: '22px 0 6px' };
const row = { display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '6px 0', fontSize: '13.5px' };

// Terms: fees and costs. Every charge is listed here, with the numbers read from the same data the app uses.
export default function Terms() {
  const { data: cat } = useApi('/api/plans', { ttl: 60000 });
  const halls = cat?.halls || defaultHalls;
  const hallList = Object.values(halls).map((h) => ({ h, r: hallRates(h) })).filter((x) => x.r);
  const coinRows = Object.entries(ASSETS).flatMap(([, a]) => Object.entries(a.nets).map(([net, fee]) => ({ k: `${a.sym}-${net}`, label: `${a.sym} on ${NETWORKS[net].short}`, fee: `${fee} ${a.sym}` })));

  return (
    <section id="auth">
      <div className="authbox" style={{ textAlign: 'left', maxWidth: '560px' }}>
        <h1>Terms: fees and costs</h1>
        <p className="mute">What you pay, what comes out of your mining, and what is never charged.</p>

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

        <h2 style={h2}>3. Deposits and withdrawals</h2>
        <p className="mute">
          Bitcoin has no swap fee. Any other coin pays a {SWAP_FEE_PCT}% swap fee on its dollar value, on deposits (which are credited as BTC) and on withdrawals. A withdrawal also pays a flat network fee, which depends on the coin and network. The minimum withdrawal is {MIN_WITHDRAW} BTC. The amount you receive is shown before you confirm.
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

        <h2 style={h2}>4. Estimates and risk</h2>
        <p className="mute">Daily figures are estimates. Real payouts follow the BTC price and network difficulty, so they can be higher or lower. Returns are not guaranteed, cloud mining carries risk, and you can lose money. Only use funds you can afford to lose.</p>

        <h2 style={h2}>5. Nothing else is charged</h2>
        <p className="mute">A charge that is not listed on this page is not made. If a fee ever applies, it is shown before you confirm.</p>

        <div style={{ height: '14px' }} />
        <Link className="btn" href="/login" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>Back</Link>
      </div>
    </section>
  );
}
