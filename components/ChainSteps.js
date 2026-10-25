'use client';
import { useEffect, useRef } from 'react';
import Decrypt from '@/components/Decrypt';
import { useT } from '@/components/I18nProvider';

// "How it works" as a small blockchain: each step is a block that gets sealed (its hash is searched for,
// then locks in with leading zeros) as it scrolls into view. The hashes are decoration, not real data.

const HEX = '0123456789abcdef';
const HASHES = ['0000c41e9a7b', '00003f8d52e0', '0000a97b11c6'];

export default function ChainSteps({ steps }) {
  const tr = useT();
  const ref = useRef(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    const blocks = root.querySelectorAll('.ch-b');
    if (!('IntersectionObserver' in window)) {
      blocks.forEach((b) => b.classList.add('sealed'));
      return undefined;
    }
    const stops = [];
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          const b = e.target;
          io.unobserve(b);
          const i = Number(b.dataset.i);
          const code = b.querySelector('.ch-hash');
          const final = HASHES[i % HASHES.length];
          const t0 = performance.now() + i * 300;
          let raf = 0;
          const tick = (t) => {
            const k = Math.min(1, Math.max(0, (t - t0) / 900));
            const fixed = Math.floor(k * final.length);
            let s = '';
            for (let c = 0; c < final.length; c += 1) s += c < fixed ? final[c] : HEX[Math.floor(Math.random() * 16)];
            code.textContent = s;
            if (k < 1) raf = requestAnimationFrame(tick);
            else b.classList.add('sealed');
          };
          raf = requestAnimationFrame(tick);
          stops.push(() => cancelAnimationFrame(raf));
        });
      },
      { threshold: 0.7 },
    );
    blocks.forEach((b) => io.observe(b));
    return () => {
      io.disconnect();
      stops.forEach((f) => f());
    };
  }, []);

  return (
    <ol className="ch" ref={ref}>
      {steps.map((s, i) => (
        <li className="ch-b" data-i={i} key={s.t}>
          <div className="ch-n" aria-hidden="true">
            {i + 1}
          </div>
          <div className="ch-t">
            <div className="ch-h">
              <span>{tr('chain.block', { n: i + 1 })}</span>
              <code className="ch-hash" aria-hidden="true">
                {HASHES[i % HASHES.length]}
              </code>
            </div>
            <h3>
              <Decrypt when="view" text={s.t} />
            </h3>
            <p>{s.d}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
