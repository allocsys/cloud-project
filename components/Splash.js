'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clearApiCache } from '@/lib/api';
import { telegramReady } from '@/lib/telegram';

// Welcome screen for the landing page. The server renders it visible, so it covers the very first paint (no flash of
// plain text). While it shows, the page does real work: fonts, the logo and the window load event are awaited, and
// the sign-in routes are prefetched. It lifts when all of that is ready (never later than CAP) and a short minimum
// time has passed; after the first visit in a session the minimum is much shorter.
// Inside Telegram, on the first visit of a session, it also asks the server whether this Telegram already has an account
// (it never creates one). If so the person is signed in and sent to the dashboard, and the landing page never shows.
// After a sign-out on purpose (vtx-out) this stays off until the person signs in again.
// After the first visit in a session the welcome screen is skipped altogether (a head script in the root layout hides it before the first paint
// on a reload or a language change; <html data-sp="off"> does that), and the scrambling headings stay plain (components/Decrypt.js).
const FIRST = 2400;
const REPEAT = 250;
const CAP = 3500;
const AUTO = 2600; // a little longer while the account check runs
const CHECK = 4000; // the check gives up after this
const WAIT = 1500; // how long to wait for the Telegram script (it loads after the page)

const ready = (p) => p.then(() => {}, () => {});

function loaded() {
  if (document.readyState === 'complete') return Promise.resolve();
  return new Promise((r) => window.addEventListener('load', r, { once: true }));
}

function image(src) {
  return new Promise((r) => {
    const img = new Image();
    img.onload = r;
    img.onerror = r;
    img.src = src;
    if (img.decode) img.decode().then(r, r);
  });
}

function idle() {
  return new Promise((r) => (window.requestIdleCallback ? window.requestIdleCallback(r, { timeout: 600 }) : setTimeout(r, 120)));
}

// The orb: dots assemble into the logo over a turning gold globe. Plain canvas, no libraries. Returns a stop function.
function startOrb(c) {
  const g = c.getContext('2d');
  if (!g) return undefined;
  const N = 520;
  const ga = Math.PI * (3 - Math.sqrt(5));
  const pts = [];
  for (let i = 0; i < N; i++) {
    const y = 1 - (2 * (i + 0.5)) / N;
    const r = Math.sqrt(1 - y * y);
    pts.push([Math.cos(ga * i) * r, y, Math.sin(ga * i) * r]);
  }
  const poly = [[0, 0], [28.5, 0], [43.5, 44], [58.5, 0], [87, 0], [43.5, 78]];
  const inside = (x, y) => {
    let ins = false;
    for (let k = 0, j = poly.length - 1; k < poly.length; j = k++) {
      const a = poly[k];
      const b = poly[j];
      if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) ins = !ins;
    }
    return ins;
  };
  const cut = (x, y) => {
    const d1 = Math.abs(y - (47.1 - 0.4069 * (x + 6))) * 0.93;
    const d2 = Math.abs(y - (65.1 - 0.4078 * (x + 6))) * 0.93;
    return d1 < 3.2 || d2 < 3.2;
  };
  let seed = 11;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const S = 0.82;
  const logo = [];
  for (let gy = 1.5; gy < 78; gy += 3.6) {
    for (let gx = 1.5; gx < 87; gx += 3.6) {
      if (inside(gx, gy) && !cut(gx, gy)) {
        const tx = (gx - 43.5) * S;
        const ty = (gy - 39) * S;
        const ang = rnd() * 6.2832;
        const rad = Math.sqrt(rnd()) * 92;
        logo.push({
          tx,
          ty,
          f: (gx + gy) / 165,
          sx: Math.cos(ang) * rad,
          sy: Math.sin(ang) * rad,
          del: rnd() * 0.9 + (Math.sqrt(tx * tx + ty * ty) / 70) * 0.5,
        });
      }
    }
  }
  // The disc behind the logo takes the page background colour.
  let bg = '11,15,26';
  try {
    const m = /^#([0-9a-f]{6})$/i.exec(getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
    if (m) {
      const n = parseInt(m[1], 16);
      bg = `${n >> 16},${(n >> 8) & 255},${n & 255}`;
    }
  } catch {}
  const tilt = 0.38;
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const R = 104;
  const cx = 120;
  const cy = 120;
  const CYC = 7.2;
  const t0 = Date.now();
  const mix = (a, b, f) => Math.round(a + (b - a) * f);
  const cl = (x) => Math.max(0, Math.min(1, x));
  const io = (x) => {
    const v = cl(x);
    return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2;
  };
  const draw = () => {
    const T = (Date.now() - t0) / 1000;
    const t = (T * 1.7) % CYC; // the logo phases run 1.7x faster than the globe turns
    const rot = T * 0.7;
    const cr = Math.cos(rot);
    const sr = Math.sin(rot);
    const scan = (T * 1.1) % (Math.PI * 2);
    const fade = 1 - io((t - 6.4) / 0.7);
    const disc = io((t - 1.6) / 1.8) * fade;
    const glow = Math.max(0, 1 - Math.abs(t - 3.7) / 0.7) * fade;
    g.clearRect(0, 0, 240, 240);
    const out = [];
    for (let i = 0; i < N; i++) {
      const p = pts[i];
      const x = p[0] * cr + p[2] * sr;
      const z = -p[0] * sr + p[2] * cr;
      const lon = Math.atan2(p[2], p[0]);
      let d = Math.abs(((lon + rot - scan + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      d = Math.PI - d;
      out.push([x, p[1] * ct - z * st, p[1] * st + z * ct, Math.max(0, 1 - d / 0.22)]);
    }
    out.sort((a, b) => a[2] - b[2]);
    for (let i = 0; i < N; i++) {
      const o = out[i];
      const dep = (o[2] + 1) / 2;
      const lt = Math.min(1, 0.15 + 0.55 * dep + o[3] * 0.7);
      const a = Math.min(1, 0.12 + 0.6 * dep + o[3] * 0.35);
      g.fillStyle = `rgba(${mix(199, 255, lt)},${mix(127, 210, lt)},${mix(10, 122, lt)},${a.toFixed(3)})`;
      g.beginPath();
      g.arc(cx + o[0] * R, cy - o[1] * R, 0.7 + 1.6 * dep + o[3] * 1.1, 0, 6.2832);
      g.fill();
    }
    g.fillStyle = `rgba(${bg},${(0.62 * disc).toFixed(3)})`;
    g.beginPath();
    g.arc(cx, cy, 52, 0, 6.2832);
    g.fill();
    if (glow > 0) {
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, 62);
      gr.addColorStop(0, `rgba(255,184,77,${(0.38 * glow).toFixed(3)})`);
      gr.addColorStop(1, 'rgba(245,165,36,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(cx, cy, 62, 0, 6.2832);
      g.fill();
    }
    for (let k = 0; k < logo.length; k++) {
      const q = logo[k];
      if (t < 0.7 + q.del) continue;
      const e = io((t - 0.7 - q.del) / 1.7);
      const sw = (1 - e) * 1.5;
      const ca = Math.cos(sw);
      const sa = Math.sin(sw);
      const px = q.sx * (1 - e) + q.tx * e;
      const py = q.sy * (1 - e) + q.ty * e;
      const ox = (px * ca - py * sa) * (1 - e) + px * e;
      const oy = (px * sa + py * ca) * (1 - e) + py * e;
      const sh = 0.5 + 0.5 * Math.sin(T * 2.4 - q.f * 5);
      const f = q.f;
      g.fillStyle = `rgb(${mix(255, mix(255, 212, f), e)},${mix(210, mix(184, 136, f), e)},${mix(140, mix(77, 15, f), e)})`;
      g.globalAlpha = cl(e * 3) * fade * (e < 1 ? 0.55 + 0.45 * e : 0.85 + 0.15 * sh);
      g.beginPath();
      g.arc(cx + ox, cy + oy, (0.9 + 0.7 * e + 0.3 * sh * e) * (1 + 0.4 * glow), 0, 6.2832);
      g.fill();
    }
    g.globalAlpha = 1;
  };
  draw();
  const timer = setInterval(draw, 33);
  return () => clearInterval(timer);
}

export default function Splash() {
  const ref = useRef(null);
  const bar = useRef(null);
  const orb = useRef(null);
  const [gone, setGone] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let seen = false;
    try {
      seen = sessionStorage.getItem('vtx-splash') === '1';
      sessionStorage.setItem('vtx-splash', '1');
    } catch {}
    const t0 = performance.now();
    window.__vtxSeen = seen;
    if (seen) {
      window.__vtxSplash = 'off';
      document.documentElement.dataset.sp = 'off';
      try {
        router.prefetch('/login');
      } catch {}
      setGone(true);
      window.dispatchEvent(new Event('vtx-splash-done'));
      return undefined;
    }
    window.__vtxSplash = 'on';
    let out = false;
    try {
      out = localStorage.getItem('vtx-out') === '1';
    } catch {}
    const tg = window.Telegram && window.Telegram.WebApp;
    // Telegram puts its launch data in the URL hash, so that shows we are inside Telegram even before the script is here.
    const inTg = /tgWebApp(Data|Platform)/.test(window.location.hash);
    const auto = !seen && !out && !!((tg && tg.initData) || inTg);
    let dead = false;
    let check = null;
    if (auto) {
      try {
        router.prefetch('/dashboard');
      } catch {}
      const ctl = new AbortController();
      const stop = setTimeout(() => ctl.abort(), CHECK);
      check = telegramReady(WAIT)
        .then((w) =>
          w && w.initData
            ? fetch('/api/auth/telegram', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ initData: w.initData, existing: true }),
                signal: ctl.signal,
              }).then((r) => r.ok)
            : false,
        )
        .catch(() => false)
        .finally(() => clearTimeout(stop));
    }
    const fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    try {
      router.prefetch('/login');
    } catch {}
    // Each finished task moves the bar forward, so what it shows is real progress, not a timer.
    const total = auto ? 6 : 5;
    let done = 1;
    const step = () => {
      done += 1;
      if (bar.current) bar.current.style.transform = `scaleX(${Math.min(1, done / total)})`;
    };
    if (bar.current) bar.current.style.transform = `scaleX(${done / total})`;
    const track = (p) => ready(p).then(step);
    const work = Promise.all([track(fonts), track(loaded()), track(image('/logo.svg')), ...(check ? [track(check)] : [])])
      .then(() => idle())
      .then(step);
    let t1 = 0;
    let t2 = 0;
    Promise.race([work, new Promise((r) => setTimeout(r, CAP))]).then(async () => {
      const signedIn = check ? await check : false;
      if (dead) return;
      if (signedIn) clearApiCache(); // nothing from a previous account may show for this one
      const wait = Math.max(0, (auto ? AUTO : seen ? REPEAT : FIRST) - (performance.now() - t0));
      t1 = setTimeout(() => {
        if (bar.current) bar.current.style.transform = 'scaleX(1)';
        if (signedIn) {
          // The welcome screen stays up until the dashboard takes over. If that never happens, lift it after a while.
          router.replace('/dashboard');
          t2 = setTimeout(() => setGone(true), 6000);
          return;
        }
        if (ref.current) ref.current.classList.add('sp-out');
        window.__vtxSplash = 'off';
        window.dispatchEvent(new Event('vtx-splash-done'));
        // data-sp=off is for repeat visits only (set above and by the head script): it turns the Decrypt text plain at once.
        t2 = setTimeout(() => setGone(true), 600);
      }, wait);
    });
    return () => {
      dead = true;
      window.__vtxSplash = 'off';
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (gone || !orb.current || document.documentElement.dataset.sp === 'off') return undefined;
    return startOrb(orb.current);
  }, [gone]);

  if (gone) return null;
  return (
    <div className="splash" ref={ref} aria-hidden="true">
      <noscript>
        <style>{'.splash{display:none}'}</style>
      </noscript>
      <canvas className="sp-orb" ref={orb} width="240" height="240" />
      <div className="sp-name">Vertexhash</div>
      <div className="sp-track">
        <div className="sp-bar" ref={bar} />
      </div>
    </div>
  );
}
