import { cookies } from 'next/headers';
import { COOKIE } from '@/lib/server/auth';
import { getLang, getT } from '@/lib/i18n/server';
import { LANGS } from '@/lib/i18n/langs';

export const dynamic = 'force-dynamic';

// The entry page for the Telegram Mini App (set /go as the Mini App link in BotFather). The main site stays at /.
// One screen, no scroll: logo, one line, one button. It is plain HTML with a little inline CSS and script: no React, no
// images, no fonts, no libraries, so it opens at once (about 6 KB). Colours are the app palette (app/globals.css :root).
// In Telegram the button signs in with the Mini App data (the same /api/auth/telegram the sheet uses) and opens Plans.
// Elsewhere it opens the sign-up sheet on the home page. Outside Telegram and the installed app it also hints how to install.
// The installed app starts here (app/manifest.js). Someone already signed in sees the same screen with a loading bar instead of the button, then goes to the dashboard (about 1.5 s).
// Motion is CSS only (transform and opacity). The slow, soft effects (rings, drifting bits, entrance) also run when the phone's
// "reduce motion" is on, because a still page looked unfinished; only the quick ones (button shimmer, arrow nudge) stop then.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Decorative bits that drift up behind the page: [left %, seconds, delay, text]. They say nothing and mean nothing.
const BITS = [[8, 9, 0, '0x3f'], [22, 11, 2, 'a7'], [36, 8, 4, '00e1'], [52, 10, 1, '9c'], [66, 12, 3, 'b2f0'], [80, 9, 5, '4d'], [90, 11, 6, 'e8'], [14, 10, 7, '1a5'], [72, 8, 8, '7e']];
const SPARKS = BITS.map(([x, d, s, v]) => `<span style="--x:${x}%;--d:${d}s;--s:${s}s">${v}</span>`).join('');

const CSS = `*{box-sizing:border-box}html,body{margin:0;height:100%;background:#0B0F1A;color:#E8ECF4}
body{position:relative;display:flex;flex-direction:column;height:100dvh;overflow:hidden;font:400 16px/24px Roboto,system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);background:radial-gradient(70% 45% at 50% 36%,rgba(245,165,36,.17),transparent 70%),radial-gradient(60% 30% at 50% 100%,rgba(245,165,36,.06),transparent 70%),#0B0F1A}
.s{position:absolute;inset:0;overflow:hidden;pointer-events:none}
.s span{position:absolute;bottom:-16px;left:var(--x);font:11px ui-monospace,Menlo,Consolas,monospace;color:#F5A524;opacity:0;animation:f var(--d) linear var(--s) infinite}
@keyframes f{0%{transform:translateY(0);opacity:0}15%{opacity:.4}85%{opacity:.2}100%{transform:translateY(-110dvh);opacity:0}}
main{position:relative;flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px;gap:28px}
@keyframes u{from{opacity:0;transform:translateY(12px)}}
.m{position:relative;width:104px;height:104px;animation:u .7s cubic-bezier(.2,.7,.2,1) backwards}
.r{position:absolute;inset:0;border-radius:30px;border:1px solid #F5A524;opacity:0;animation:r 3.6s ease-out infinite}
.r:nth-child(2){animation-delay:1.2s}.r:nth-child(3){animation-delay:2.4s}
@keyframes r{0%{transform:scale(1);opacity:.55}100%{transform:scale(2.6);opacity:0}}
.t{position:absolute;inset:0;display:grid;place-items:center;border-radius:30px;background:#121826;border:1px solid #263047;box-shadow:0 0 0 10px rgba(245,165,36,.05),0 24px 64px rgba(245,165,36,.2);animation:p 3.6s ease-in-out infinite}
@keyframes p{50%{transform:scale(1.05)}}
.t svg{width:56px;height:52px}
h1{margin:0;font-weight:500;font-size:clamp(21px,6vw,25px);line-height:1.25}
h1 span{display:block;animation:u .7s cubic-bezier(.2,.7,.2,1) .3s backwards}h1 .y{color:#F5A524;animation-delay:.55s}
.b{position:relative;overflow:hidden;display:inline-flex;align-items:center;justify-content:center;gap:8px;width:100%;max-width:240px;min-height:46px;border:0;border-radius:23px;background:linear-gradient(180deg,#FFC463 0%,#F5A524 52%,#DE8C0A 100%);box-shadow:0 8px 22px rgba(245,165,36,.3),inset 0 1px 0 rgba(255,255,255,.55),inset 0 -2px 0 rgba(120,60,0,.25);color:#0B0F1A;font-family:inherit;font-weight:500;font-size:15px;line-height:20px;text-decoration:none;cursor:pointer;transition:transform .15s;animation:u .7s cubic-bezier(.2,.7,.2,1) .8s backwards}
.b:active{transform:scale(.98)}.b[disabled]{opacity:.6}
.b::before{content:'';position:absolute;left:2px;right:2px;top:2px;height:48%;border-radius:21px 21px 50% 50%/21px 21px 10px 10px;background:linear-gradient(180deg,rgba(255,255,255,.5),rgba(255,255,255,.1))}
.b>*{position:relative;z-index:1}
.b::after{content:'';position:absolute;top:0;bottom:0;left:-60%;width:36%;background:rgba(255,255,255,.4);transform:skewX(-20deg);animation:h 3.4s ease-in-out 1.6s infinite}
@keyframes h{0%{left:-60%}35%,100%{left:130%}}
.b svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;animation:a 1.6s ease-in-out infinite}
@keyframes a{50%{transform:translateX(4px)}}
[dir=rtl] .b svg{scale:-1 1}
.e{margin:-12px 0 0;color:#EF4444;font-size:14px;line-height:20px}
.n{position:relative;align-self:center;margin:0 24px 24px;padding:8px 16px;border:1px solid #263047;border-radius:20px;background:#121826;color:#8A94A8;font-size:14px;line-height:20px;text-align:center}
.n button{background:none;border:0;padding:0;color:#F5A524;font:inherit;cursor:pointer}
.l{width:100%;max-width:240px;height:4px;border-radius:2px;background:#263047;overflow:hidden;animation:u .7s cubic-bezier(.2,.7,.2,1) .5s backwards}
.l::after{content:'';display:block;height:100%;border-radius:2px;background:linear-gradient(90deg,#FFC463,#F5A524);transform-origin:left;animation:k 1s ease-in-out .5s both}
@keyframes k{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@media (prefers-reduced-motion:reduce){.b::after,.b svg{animation:none}}`;

const LOGO = `<div class="m"><span class="r"></span><span class="r"></span><span class="r"></span><div class="t"><svg viewBox="0 0 87 78" role="img" aria-label="Vertexhash"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFB84D"/><stop offset=".55" stop-color="#F5A524"/><stop offset="1" stop-color="#D4880F"/></linearGradient></defs><path d="M0 0H28.5L43.5 44L58.5 0H87L43.5 78Z" fill="url(#g)"/><path d="M-6 47.1L96 5.6" stroke="#121826" stroke-width="4" fill="none"/><path d="M-6 65.1L96 23.5" stroke="#121826" stroke-width="4" fill="none"/></svg></div></div>`;

const ARROW = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;

// Runs in the browser. In Telegram (the Mini App data is in the address after #): tells Telegram the app is ready, then the
// button signs in. Outside Telegram and the installed app: the install hint (iOS text, or an Install button where the browser offers one).
const JS = `(function(){
var $=function(i){return document.getElementById(i)},b=$('b'),e=$('e'),n=$('n'),d=null;
try{d=new URLSearchParams(location.hash.slice(1)).get('tgWebAppData')}catch(x){}
function ev(k,v){try{var w=window.TelegramWebviewProxy;if(w&&w.postEvent)w.postEvent(k,JSON.stringify(v||{}));else if(parent!==window)parent.postMessage(JSON.stringify({eventType:k,eventData:v||{}}),'*')}catch(x){}}
if(d){ev('web_app_ready');ev('web_app_expand');ev('web_app_set_header_color',{color:'#0B0F1A'});ev('web_app_set_background_color',{color:'#0B0F1A'})}
if(document.body.hasAttribute('data-in')){
var l=document.createElement('link');l.rel='prefetch';l.href='/dashboard';document.head.appendChild(l);
setTimeout(function(){location.replace('/dashboard')},1500);return}
if(d){
{b.onclick=function(a){
a.preventDefault();if(b.disabled)return;b.disabled=true;e.hidden=true;
var r='';try{r=new URLSearchParams(d).get('start_param')||''}catch(x){}
if(!/^[\\w-]{1,24}$/.test(r)){r='';try{r=(localStorage.getItem('vtx-ref')||'').trim().slice(0,24)}catch(x){}}
fetch('/api/auth/telegram',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(r?{initData:d,ref:r}:{initData:d})})
.then(function(s){if(!s.ok)throw 0;try{localStorage.removeItem('vtx-ref')}catch(x){}location.href='/plans'})
.catch(function(){b.disabled=false;e.hidden=false})}}
return}
if(matchMedia('(display-mode: standalone)').matches||navigator.standalone)return;
if(/iphone|ipad|ipod/i.test(navigator.userAgent)){n.textContent=n.dataset.ios;n.hidden=false}
addEventListener('beforeinstallprompt',function(a){a.preventDefault();n.innerHTML='<button type="button">'+n.dataset.inst+'</button>';n.hidden=false;
n.firstChild.onclick=function(){a.prompt();n.hidden=true}});
})();`;

export async function GET() {
  const jar = await cookies();
  const signed = jar.has(COOKIE);
  const lang = await getLang();
  const t = await getT();
  const html = `<!doctype html><html lang="${lang}" dir="${LANGS[lang].dir}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0B0F1A"><meta name="color-scheme" content="dark"><meta name="robots" content="noindex">
<title>Vertexhash</title><link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/logo.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/icons/apple">
<style>${CSS}</style>${signed ? '<meta http-equiv="refresh" content="4;url=/dashboard">' : ''}</head><body${signed ? ' data-in' : ''}><div class="s" aria-hidden="true">${SPARKS}</div><main>${LOGO}
<h1><span>${esc(t('go.h1a'))}</span><span class="y">${esc(t('go.h1b'))}</span></h1>
${signed ? '<div class="l" aria-hidden="true"></div>' : `<a id="b" class="b" href="/?auth=signup"><span>${esc(t('landing.start'))}</span>${ARROW}</a>`}
<p id="e" class="e" hidden>${esc(t('go.err'))}</p></main>
<p id="n" class="n" hidden data-ios="${esc(t('go.ios'))}" data-inst="${esc(t('go.install'))}"></p>
<script>${JS}${process.env.NODE_ENV === 'production' ? `if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(function(){});` : ''}</script></body></html>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-cache' } });
}
