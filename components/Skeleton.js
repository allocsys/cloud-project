'use client';
import { useEffect, useState } from 'react';

// Shimmering placeholders, shown only when a screen has no data at all yet (a first-ever start, nothing saved on the phone).
// Once any data has been seen, the saved copy fills the screen at once (lib/api.js) and these are not needed.
// Styles: .sk in app/globals.css. Each placeholder follows the layout of the screen it stands in for, so nothing jumps when the data arrives.

// True while `pending` holds, but only for `ms`: if the answer never comes, the screen falls back to what it showed before
// instead of shimmering for ever.
export function useWaiting(pending, ms = 6000) {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!pending) {
      setLate(false);
      return undefined;
    }
    const t = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(t);
  }, [pending, ms]);
  return pending && !late;
}

// One shimmering block. w and h are CSS sizes (numbers are px); r overrides the corner radius.
export function Sk({ w = '100%', h = 14, r, style }) {
  return <i className="sk" aria-hidden="true" style={{ width: w, height: h, ...(r !== undefined ? { borderRadius: r } : null), ...style }} />;
}

const SPLIT = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 };

// A card with a short heading and a few lines.
export function SkCard({ lines = 3, heading = true }) {
  return (
    <div className="card skc" aria-hidden="true">
      {heading && <Sk w="38%" h={16} />}
      {Array.from({ length: lines }).map((_, i) => (
        <Sk key={i} w={i === lines - 1 ? '62%' : '100%'} h={12} />
      ))}
    </div>
  );
}

// A card head: a title on the left, a small figure on the right.
function SkHead({ w = '36%' }) {
  return (
    <div style={SPLIT}>
      <Sk w={w} h={16} />
      <Sk w="22%" h={12} />
    </div>
  );
}

// A card with a head, a bar chart and its two date labels, and (chips) two small figures under it.
function SkChartCard({ chips = false }) {
  return (
    <div className="card skc" aria-hidden="true">
      <SkHead />
      <Sk h={96} r={10} />
      <div style={SPLIT}>
        <Sk w="22%" h={10} />
        <Sk w="14%" h={10} />
      </div>
      {chips && (
        <div style={{ display: 'flex', gap: 8 }}>
          <Sk h={44} r={12} />
          <Sk h={44} r={12} />
        </div>
      )}
    </div>
  );
}

// A list row as the screens draw it (same divider and spacing): the left side and the right side are given.
function SkRow({ first = false, left, right }) {
  return (
    <div className="row" aria-hidden="true" style={first ? { borderTop: 0 } : undefined}>
      {left}
      {right}
    </div>
  );
}

// Two stacked lines (a title and a small line under it).
function SkTwo({ a = '60%', b = '40%', w = '55%' }) {
  return (
    <div className="skc" style={{ gap: 8, width: w, flex: 'none' }}>
      <Sk w={a} h={13} />
      <Sk w={b} h={10} />
    </div>
  );
}

// The Earnings hero: label and chip, the big figure, the week chart, four small figures and the payout line.
export function SkHero() {
  return (
    <div className="card hero skc" aria-hidden="true">
      <div style={SPLIT}>
        <Sk w="30%" h={12} />
        <Sk w="34%" h={22} r={11} />
      </div>
      <Sk w="68%" h={38} r={10} />
      <Sk w="26%" h={12} />
      <Sk h={64} r={10} />
      <div className="skrow">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skcol">
            <Sk w="70%" h={16} />
            <Sk w="50%" h={10} />
          </div>
        ))}
      </div>
      <Sk w="56%" h={12} />
    </div>
  );
}

// List rows (an icon, two lines, and something on the right) for activity and notification lists.
// right: 'amount' (one figure), 'two' (a figure with a small line under it) or 'time' (a small time).
export function SkRows({ n = 3, right = 'amount' }) {
  return (
    <>
      {Array.from({ length: n }).map((_, i) => (
        <SkRow
          key={i}
          first={i === 0}
          left={
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
              <Sk w={34} h={34} r="50%" style={{ flex: 'none' }} />
              <SkTwo w="100%" a="55%" b="38%" />
            </div>
          }
          right={
            right === 'two' ? (
              <div className="skc" style={{ gap: 6, width: 72, flex: 'none', justifyItems: 'end' }}>
                <Sk w={64} h={13} />
                <Sk w={44} h={10} />
              </div>
            ) : right === 'time' ? (
              <Sk w={36} h={10} style={{ flex: 'none' }} />
            ) : (
              <Sk w={64} h={13} style={{ flex: 'none' }} />
            )
          }
        />
      ))}
    </>
  );
}

// A pill in the tab bar, standing in for a tab whose presence is not known yet.
export function SkTab() {
  return <i className="sk sktab" aria-hidden="true" />;
}

// The row of tier marks under a slider.
function SkTicks() {
  return (
    <div className="skrow" style={{ marginTop: 0 }}>
      {[0, 1, 2, 3].map((i) => (
        <Sk key={i} w="60%" h={10} style={{ justifySelf: i === 0 ? 'start' : i === 3 ? 'end' : 'center' }} />
      ))}
    </div>
  );
}

// Buy plans before the catalogue: the Smart Mining card (title, dial, figures, slider, tier marks, term pills, note, button)
// and the ASICs card (title, rig, figures, slider, tier marks, term pills, price line, button).
export function SkPlans() {
  return (
    <>
      <div className="card skc" aria-hidden="true">
        <div style={SPLIT}>
          <Sk w="30%" h={18} />
          <Sk w="40%" h={12} />
        </div>
        <Sk w="46%" h={150} r="50%" style={{ margin: '8px auto' }} />
        <div className="skrow" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <Sk w="60%" h={30} r={10} />
          <Sk w="60%" h={30} r={10} style={{ justifySelf: 'end' }} />
        </div>
        <Sk w="38%" h={11} />
        <Sk h={8} r={4} />
        <SkTicks />
        <div className="skrow">
          {[0, 1, 2, 3].map((i) => (
            <Sk key={i} h={46} r={14} />
          ))}
        </div>
        <Sk w="55%" h={11} style={{ justifySelf: 'center' }} />
        <Sk h={50} r={25} />
      </div>
      <SkAsics />
    </>
  );
}

// The ASICs card on its own.
export function SkAsics() {
  return (
    <div className="card skc" aria-hidden="true">
      <div style={SPLIT}>
        <Sk w="22%" h={18} />
        <Sk w="40%" h={12} />
      </div>
      <Sk w="64%" h={96} r={14} style={{ margin: '8px auto' }} />
      <div style={SPLIT}>
        <Sk w="38%" h={26} r={8} />
        <Sk w="24%" h={14} />
      </div>
      <Sk h={8} r={4} />
      <SkTicks />
      <div className="skrow">
        {[0, 1, 2, 3].map((i) => (
          <Sk key={i} h={40} r={14} />
        ))}
      </div>
      <div style={SPLIT}>
        <SkTwo w="55%" a="60%" b="80%" />
        <Sk w={56} h={20} />
      </div>
      <Sk h={50} r={25} />
    </div>
  );
}

// My miners before the list: two miner cards.
export function SkMiners() {
  return (
    <div className="clist">
      {[0, 1].map((i) => (
        <div key={i} className="card skc" aria-hidden="true">
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <Sk w={54} h={54} r={12} />
            <div className="skc" style={{ flex: 1 }}>
              <Sk w="50%" h={16} />
              <Sk w="80%" h={12} />
            </div>
          </div>
          <Sk h={6} r={3} />
          <Sk w="70%" h={11} />
        </div>
      ))}
    </div>
  );
}

// Boost before its first answer.
export function SkBoost() {
  return <SkCard lines={5} />;
}

// The Earnings screen before its first data: the hero, the two carousel dots and the miners strip.
export function SkDash() {
  return (
    <>
      <SkHero />
      <div aria-hidden="true" style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
        <Sk w={8} h={8} r="50%" />
        <Sk w={8} h={8} r="50%" />
      </div>
      <div className="card" aria-hidden="true" style={SPLIT}>
        <Sk w="42%" h={16} />
        <Sk w="18%" h={14} />
      </div>
    </>
  );
}

// The miner page before its data: the hero (rig, earned figure, progress, dates), then the earnings and uptime charts and the details.
export function SkMinerPage() {
  return (
    <>
      <div className="card hero skc" aria-hidden="true">
        <Sk h={110} r={14} />
        <Sk w="40%" h={12} />
        <Sk w="46%" h={38} r={10} />
        <Sk w="32%" h={14} />
        <Sk h={4} r={2} />
        <div style={SPLIT}>
          <Sk w="28%" h={12} />
          <Sk w="30%" h={12} />
        </div>
      </div>
      <div className="grid cols">
        <SkChartCard chips />
        <SkChartCard />
        <div className="card skc" aria-hidden="true">
          <Sk w="30%" h={16} />
          <Sk h={40} r={10} />
          {[0, 1, 2, 3, 4].map((i) => (
            <SkRow key={i} first={i === 0} left={<Sk w="30%" h={12} />} right={<SkTwo w="40%" a="80%" b="60%" />} />
          ))}
        </div>
      </div>
    </>
  );
}

// Settings before the account: the account card (rows with a button) and the preferences card (theme, language, three switches, sign out).
export function SkSettings() {
  return (
    <>
      <div className="card" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <SkRow key={i} first={i === 0} left={<SkTwo w="55%" a="45%" b="70%" />} right={<Sk w={84} h={34} r={12} />} />
        ))}
      </div>
      <div className="card" aria-hidden="true">
        <SkRow first left={<Sk w="28%" h={14} />} right={<Sk w={150} h={32} r={10} />} />
        <SkRow left={<Sk w="32%" h={14} />} right={<Sk w={70} h={32} r={10} />} />
        {[0, 1, 2].map((i) => (
          <SkRow key={i} left={<Sk w="40%" h={14} />} right={<Sk w={44} h={26} r={13} />} />
        ))}
        <Sk h={48} r={24} style={{ marginTop: 8 }} />
      </div>
    </>
  );
}

// KYC before its answer: the step bars, the step name, three fields and a button.
export function SkKyc() {
  return (
    <div className="card skc" aria-hidden="true">
      <div className="skrow" style={{ marginTop: 0, gap: 6 }}>
        {[0, 1, 2, 3].map((i) => (
          <Sk key={i} h={4} r={2} />
        ))}
      </div>
      <Sk w="34%" h={12} />
      {[0, 1, 2].map((i) => (
        <div key={i} className="skcol" style={{ gap: 6 }}>
          <Sk w="26%" h={12} />
          <Sk h={46} r={12} />
        </div>
      ))}
      <Sk h={50} r={25} />
    </div>
  );
}

// Invite before its data (under the hero): the VIP card and the codes card with its three buttons.
export function SkInvite() {
  return (
    <>
      <div className="card skc" aria-hidden="true">
        <div style={SPLIT}>
          <Sk w="30%" h={12} />
          <Sk w="16%" h={22} r={11} />
        </div>
        <Sk w="90%" h={14} />
        <Sk h={8} r={4} />
        <Sk w="70%" h={11} />
        <Sk w="55%" h={11} />
      </div>
      <div className="card skc" aria-hidden="true">
        <Sk w="24%" h={12} />
        <div style={SPLIT}>
          <Sk w="34%" h={14} />
          <Sk w="22%" h={22} r={11} />
        </div>
        <Sk h={52} r={12} />
        <div className="skrow" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {[0, 1, 2].map((i) => (
            <Sk key={i} h={44} r={12} />
          ))}
        </div>
        <Sk w="30%" h={11} />
      </div>
    </>
  );
}
