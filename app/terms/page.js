'use client';
import BackLink from '@/components/BackLink';
import { halls as defaultHalls, MIN_WITHDRAW, MIN_WITHDRAW_USD } from '@/lib/data';
import { ASSETS, NETWORKS, SWAP_FEE_PCT } from '@/lib/assets';
import { hallRates, MAINT_PER_TH_DAY } from '@/lib/fees';
import { SMART } from '@/lib/smart';
import { REFUND_HOURS, UP_RATIO, servicePctText } from '@/lib/rules';
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
        <p className="mute">The price of ASICs power follows the live mining market and can change from one hour to the next. The price you see when you confirm is the price you pay, and it is locked when you buy: a later change in the market does not change a plan you already own.</p>

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
          You can ask for a full refund within {REFUND_HOURS} hours of buying, as long as the miner has not paid out yet (the first payout day ends at 00:00 UTC, so ask before then). The price goes back to your balance, in BTC at the rate on the day of the refund, and the miner is removed. After that, purchases are not refunded, because the machines are already working for you. Where the law of your country gives you a longer right to cancel, that right applies.
        </p>
        <p className="mute">If a machine fails or a hall goes offline, we move your hash power to another machine. If we cannot, the days lost are added to the end of your term.</p>
        <p className="mute">
          First-buy bonus. When it is available, the first plan you buy with crypto may include extra hashrate for its full term, shown before you pay. It is fixed when the miner starts and ends with its term. It is not cash and cannot be withdrawn. It does not apply to purchases paid from your balance or to renewals. If you refund that miner, the bonus goes with it and is not offered again. Bonuses can be stopped at any time, and users can be disqualified for many reasons.
        </p>
        <p className="mute">
          Boost tickets. A ticket starts a boost of extra hashrate that runs for 2 hours and pays a fixed amount when it ends. Each ticket also has a prize draw: the chance and the prize are shown before you buy and are fixed for that ticket. The draw is made when you buy and shown when the boost ends. Each ticket is a separate draw. Tickets are paid from your balance, and the boost pay and any prize are added to your balance when the boost ends. Tickets are not refundable.
        </p>

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
        <p className="mute">A service fee of {servicePctText()} applies to withdrawals, depending on the time since your last withdrawal, as set out in the FAQ.</p>
        <p className="mute">Withdrawals are checked by our team before they are paid, so they are not instant. A withdrawal can be held while we check your identity or look into suspected fraud.</p>

        <h2 style={h2}>5. Estimates and risk</h2>
        <p className="mute">Daily figures are estimates. Real payouts follow the BTC price and network difficulty, so they can be higher or lower. Returns are not guaranteed, cloud mining carries risk, and you can lose money. Only use funds you can afford to lose. Nothing here is financial advice.</p>
        <p className="mute">
          Each day&apos;s payout is worked out from that day&apos;s market: what your hash power mines at the network difficulty and BTC price of the day, minus the electricity and maintenance in section 2. If those costs are higher than what the machines mine on a day, that day pays nothing; you never owe us anything. A day that has been paid is not changed afterwards. The daily figure on a plan screen uses today&apos;s market and is not a promise: if the BTC price falls or difficulty rises, your payouts fall, and over the term you may receive less than the plan cost.
        </p>
        <p className="mute">
          To avoid mining at a loss, we may switch a hall, or Smart Mining, off for a whole UTC day when that day would not be profitable. This is decided once the day is over, from that day&apos;s final market, and a decided day is not changed afterwards. We can also pause or resume a hall by hand. A paused day pays nothing. Depending on the setting in force when you bought the plan, a paused day is either added to the end of your term or counts as one of its days; your miner page lists paused days and shows the end date of your term. Paused days are not counted against uptime.
        </p>
        <p className="mute">
          Smart Mining follows the same rules on estimates and risk. You choose a budget and a term, and each day we mine the coin that looks most profitable that day. Payouts are still made in BTC. The figure shown is an estimate at today&apos;s market, not a promise, and you may receive less than your budget. Smart Mining can be switched off or its rate changed for new purchases; a Smart Mining plan you already own keeps the rate it was bought at.
        </p>
        <p className="mute">
          Smart Mining does not give you a fixed number of machines. Each day your budget runs on the halls of the coin it is on: ASIC machines for BTC, GPU machines for KAS and RVN, CPU machines for XMR. Your miner page shows that hall and rig, the hashrate your budget is contracted for that day in the unit of the coin (TH/s, GH/s, MH/s or KH/s), and an uptime figure, which is the share of hours in which the hall reported at least {Math.round(UP_RATIO * 100)}% of that hashrate. The hashrate and uptime are a measure of the service; what you are paid is worked out from your budget and the market as described above, not from the hashrate shown.
        </p>
        <p className="mute">
          Smart Mining also uses a reserve to even out your daily payout. Each plan has a daily rate, shown when you buy. The rate depends on your budget and your term: a larger budget or a longer term gets a higher rate, and a budget between two steps of our rate table gets a rate worked out smoothly between them. Profits are estimated and not promised: they fluctuate with network difficulty and coin prices. A day&apos;s profit is kept within {+(SMART.bandShare * 100).toFixed(0)}% either side of your plan&apos;s own rate. Profit above the top of that range goes into the plan&apos;s reserve instead of your payout. When a day falls below the bottom of the range, it is topped up from the reserve, but only as far as the reserve holds. When the reserve is empty, the day pays what the market gives. The reserve starts with {+(SMART.seed * 100).toFixed(2)}% of your budget, put in by us. When the term ends, that amount goes back to us, and anything left above it is split equally: {+(SMART.userShare * 100).toFixed(0)}% is paid to you and the rest is kept by us. If less than that amount is left, you receive nothing from the reserve. The reserve evens out payouts; it does not guarantee any payout or protect your budget. It is not electricity or maintenance, and it is not an extra charge. Smart Mining plans bought before the reserve existed do not have one.
        </p>

        <h2 style={h2}>6. Changes to these terms</h2>
        <p className="mute">If we change these terms or any fee, we tell you before it takes effect. A change applies only to plans bought after it. A plan you already own keeps the terms it was bought under.</p>

        <h2 style={h2}>7. Your account</h2>
        <p className="mute">You must be 18 or older and keep one account. Keep your password and two-factor codes to yourself, and turn on two-factor in Settings. We do not accept accounts from places where we cannot legally operate.</p>
        <p className="mute">You can close your account yourself in Settings at any time. Withdraw your balance first: a balance of {MIN_WITHDRAW} BTC or more, a withdrawal or a payment that is not finished yet blocks closing. A smaller balance cannot be paid out and is given up, and any running miners end with no refund. A closed account cannot be reopened; you can sign up again, but you start from nothing.</p>

        <h2 style={h2}>8. Nothing else is charged</h2>
        <p className="mute">A charge that is not listed on this page is not made. If a fee ever applies, it is shown before you confirm.</p>

        <div style={{ height: '14px' }} />
        <BackLink />
      </div>
    </section>
  );
}
