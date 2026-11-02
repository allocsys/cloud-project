// Cloudflare Worker for vertexhash.com (route: vertexhash.com/*).
// Passes every request to the app on Railway. When the app is down (502/503/504/52x, or no answer in 30 s on a read),
// it shows the maintenance page (English + Persian) instead of a raw error. The page polls /api/health and reloads
// itself when the app is back. API paths get a small JSON 503. Paste this file in Workers > Edit code.

const DOWN = new Set([502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 530]);
const TIMEOUT_MS = 30000;
const TELEGRAM = 'https://t.me/vertexhash';
const SUPPORT = 'mailto:support@vertexhash.com';

export default {
  async fetch(request) {
    const read = request.method === 'GET' || request.method === 'HEAD';
    const ctl = new AbortController();
    const timer = read ? setTimeout(() => ctl.abort(), TIMEOUT_MS) : null;
    try {
      const res = await fetch(request, read ? { signal: ctl.signal } : undefined);
      if (timer) clearTimeout(timer);
      if (!DOWN.has(res.status)) return res;
    } catch (e) {
      if (timer) clearTimeout(timer);
    }
    return down(request);
  },
};

function down(request) {
  const base = { 'cache-control': 'no-store', 'retry-after': '60', 'x-content-type-options': 'nosniff' };
  if (new URL(request.url).pathname.startsWith('/api/')) {
    return new Response(request.method === 'HEAD' ? null : '{"error":"maintenance"}', {
      status: 503,
      headers: { ...base, 'content-type': 'application/json; charset=utf-8' },
    });
  }
  return new Response(request.method === 'HEAD' ? null : PAGE, {
    status: 503,
    headers: {
      ...base,
      'content-type': 'text/html; charset=utf-8',
      'referrer-policy': 'no-referrer',
      'content-security-policy':
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'",
    },
  });
}

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><meta name="theme-color" content="#0B0F1A">
<title>Vertexhash</title>
<style>
:root{--bg:#0B0F1A;--s2:#121826;--line:#263047;--gold:#F5A524;--gold2:#FFB84D;--text:#E8ECF4;--mute:#8A94A8;color-scheme:dark}
*{box-sizing:border-box;margin:0}
body{min-height:100vh;min-height:100dvh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;text-align:center}
.card{width:100%;max-width:360px;background:var(--s2);border:1px solid var(--line);border-radius:20px;padding:32px 24px 24px}
svg{width:96px;height:96px;display:block;margin:0 auto 16px;fill:none;stroke:var(--gold);stroke-width:3;stroke-linejoin:round}
.o,.i{transform-box:fill-box;transform-origin:center}
.o{stroke-dasharray:58 22;animation:spin 9s linear infinite}
.i{stroke:var(--gold2);stroke-width:2.5;stroke-dasharray:30 14;animation:spin 6s linear infinite reverse}
.d{fill:var(--gold);stroke:none;transform-box:fill-box;transform-origin:center;animation:pulse 1.6s ease-in-out infinite}
.hash{height:20px;direction:ltr;font:13px ui-monospace,Menlo,Consolas,monospace;letter-spacing:.08em;color:var(--gold2)}
h1{font-size:22px;margin:12px 0 4px}
p{font-size:14px;color:var(--mute)}
.bar{direction:ltr;height:4px;margin:20px 0;border-radius:2px;overflow:hidden;background:rgba(245,165,36,.16)}
.bar i{display:block;width:35%;height:100%;border-radius:2px;background:var(--gold);animation:sweep 1.6s ease-in-out infinite}
.row{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
a,button{font:inherit;font-size:14px;padding:10px 16px;border-radius:12px;border:1px solid var(--line);background:none;color:var(--gold2);text-decoration:none;cursor:pointer}
a.p{background:var(--gold);border-color:var(--gold);color:#0B0F1A;font-weight:600}
button{margin-top:16px;border:0;color:var(--mute);font-size:13px}
[data-l]{display:none}
html.en [data-l=en],html.fa [data-l=fa]{display:block}
html.en .row [data-l=en],html.fa .row [data-l=fa]{display:inline-block}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes pulse{0%,100%{transform:scale(.6);opacity:.5}50%{transform:scale(1.15);opacity:1}}
@keyframes sweep{0%{transform:translateX(-100%)}100%{transform:translateX(290%)}}
@media (prefers-reduced-motion:reduce){.o,.i,.d,.bar i{animation:none}}
</style></head>
<body class="en"><div class="card">
<svg viewBox="0 0 100 100" aria-hidden="true">
<polygon class="o" points="50,6 88.1,28 88.1,72 50,94 11.9,72 11.9,28"/>
<polygon class="i" points="50,22 74.2,36 74.2,64 50,78 25.8,64 25.8,36"/>
<circle class="d" cx="50" cy="50" r="6"/>
</svg>
<div class="hash" id="h"></div>
<h1 data-l="en">Back soon</h1><h1 data-l="fa">به‌زودی برمی‌گردیم</h1>
<p data-l="en">Short upgrade. This page refreshes itself.</p><p data-l="fa">ارتقای کوتاه. این صفحه خودکار تازه می‌شود.</p>
<div class="bar"><i></i></div>
<div class="row">
<a class="p" data-l="en" href="${TELEGRAM}">Telegram channel</a><a class="p" data-l="fa" href="${TELEGRAM}">کانال تلگرام</a>
<a data-l="en" href="${SUPPORT}">Email support</a><a data-l="fa" href="${SUPPORT}">ایمیل پشتیبانی</a>
</div>
<button id="t" type="button"></button>
</div>
<script>
(function(){
var h=document.getElementById('h'),t=document.getElementById('t'),c='0123456789abcdef',d=document.documentElement;
function tick(){var s='',i;for(i=0;i<16;i++)s+=c.charAt(Math.random()*16|0);h.textContent=s}
tick();
if(!(window.matchMedia&&matchMedia('(prefers-reduced-motion:reduce)').matches))setInterval(tick,90);
function set(l){d.className=l;d.lang=l;d.dir=l==='fa'?'rtl':'ltr';t.textContent=l==='fa'?'English':'فارسی'}
set((navigator.language||'').slice(0,2)==='fa'?'fa':'en');
t.onclick=function(){set(d.className==='fa'?'en':'fa')};
setInterval(function(){
fetch('/api/health',{cache:'no-store'}).then(function(r){if(r.ok)location.reload()}).catch(function(){});
},15000);
})();
</script></body></html>`;
