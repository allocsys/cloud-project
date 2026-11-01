import { cookies } from 'next/headers';
import { COOKIE } from '@/lib/server/auth';
import { getLang, getT } from '@/lib/i18n/server';
import { LANGS } from '@/lib/i18n/langs';

export const dynamic = 'force-dynamic';

// The light entry page for the Telegram Mini App and the installed app (set /go as the Mini App link in BotFather).
// One screen, no scroll: logo, one line, one button. It is plain HTML with a little inline CSS and script: no React, no
// images, no fonts, no libraries, so it opens at once (about 4 KB). Colours are the app palette (app/globals.css :root).
// In Telegram the button signs in with the Mini App data (the same /api/auth/telegram the sheet uses) and opens Plans.
// Elsewhere it opens the sign-up sheet on the home page. Outside Telegram and the installed app it also hints how to install.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const CSS = `*{box-sizing:border-box}html,body{margin:0;height:100%;background:#0B0F1A;color:#E8ECF4}
body{display:flex;flex-direction:column;height:100dvh;overflow:hidden;font:400 16px/24px Roboto,system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}
main{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px;gap:24px}
svg{width:72px;height:72px;border-radius:20px}
h1{margin:0;font:500 26px/32px inherit;font-size:26px;line-height:32px;max-width:320px}
h1 span{color:#F5A524}
.b{display:inline-flex;align-items:center;justify-content:center;width:100%;max-width:320px;min-height:52px;border:0;border-radius:26px;background:#F5A524;color:#0B0F1A;font:500 16px/24px inherit;text-decoration:none;cursor:pointer}
.b:hover{background:#FFB84D}.b[disabled]{opacity:.6}
.e{margin:0;color:#EF4444;font-size:14px;line-height:20px}
.n{margin:0;padding:0 24px 20px;text-align:center;color:#8A94A8;font-size:14px;line-height:20px}
.n a,.n button{background:none;border:0;padding:0;color:#F5A524;font:inherit;cursor:pointer}`;

const LOGO = `<svg viewBox="0 0 512 512" role="img" aria-label="Vertexhash"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFB84D"/><stop offset=".55" stop-color="#F5A524"/><stop offset="1" stop-color="#D4880F"/></linearGradient></defs><rect width="512" height="512" rx="112" fill="#0B0F1A"/><g transform="translate(256 256) scale(3.7) translate(-43.5 -39)"><path d="M0 0H28.5L43.5 44L58.5 0H87L43.5 78Z" fill="url(#g)"/><path d="M-6 47.1L96 5.6" stroke="#0B0F1A" stroke-width="4" fill="none"/><path d="M-6 65.1L96 23.5" stroke="#0B0F1A" stroke-width="4" fill="none"/></g></svg>`;

// Runs in the browser. In Telegram (the Mini App data is in the address after #): tells Telegram the app is ready, then the
// button signs in. Outside Telegram and the installed app: the install hint (iOS text, or an Install button where the browser offers one).
const JS = `(function(){
var $=function(i){return document.getElementById(i)},b=$('b'),e=$('e'),n=$('n'),d=null;
try{d=new URLSearchParams(location.hash.slice(1)).get('tgWebAppData')}catch(x){}
function ev(k,v){try{var w=window.TelegramWebviewProxy;if(w&&w.postEvent)w.postEvent(k,JSON.stringify(v||{}));else if(parent!==window)parent.postMessage(JSON.stringify({eventType:k,eventData:v||{}}),'*')}catch(x){}}
if(d){
ev('web_app_ready');ev('web_app_expand');ev('web_app_set_header_color',{color:'#0B0F1A'});ev('web_app_set_background_color',{color:'#0B0F1A'});
if(b.dataset.in!=='1'){b.onclick=function(a){
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
  const signedIn = jar.has(COOKIE);
  const lang = await getLang();
  const t = await getT();
  const html = `<!doctype html><html lang="${lang}" dir="${LANGS[lang].dir}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0B0F1A"><meta name="color-scheme" content="dark"><meta name="robots" content="noindex">
<title>Vertexhash</title><link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/logo.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/icons/apple">
<style>${CSS}</style></head><body><main>${LOGO}
<h1>${esc(t('landing.h1a'))} <span>${esc(t('landing.h1b'))}</span></h1>
<a id="b" class="b" href="${signedIn ? '/dashboard' : '/?auth=signup'}" data-in="${signedIn ? 1 : 0}">${esc(t(signedIn ? 'landing.dashboard' : 'landing.start'))}</a>
<p id="e" class="e" hidden>${esc(t('go.err'))}</p></main>
<p id="n" class="n" hidden data-ios="${esc(t('go.ios'))}" data-inst="${esc(t('go.install'))}"></p>
<script>${JS}${process.env.NODE_ENV === 'production' ? `if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(function(){});` : ''}</script></body></html>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-cache' } });
}
