// Resolves with window.Telegram.WebApp as soon as Telegram's script has loaded, or with null after `max` ms.
// The script is loaded after the page (components/TelegramScript.js) and announces itself with the vtx-tg event,
// so nothing has to poll with timers.
export function telegramReady(max = 1500) {
  return new Promise((resolve) => {
    const get = () => (window.Telegram && window.Telegram.WebApp) || null;
    const now = get();
    if (now) {
      resolve(now);
      return;
    }
    let timer = 0;
    const done = () => {
      clearTimeout(timer);
      window.removeEventListener('vtx-tg', done);
      resolve(get());
    };
    window.addEventListener('vtx-tg', done, { once: true });
    timer = setTimeout(done, max);
  });
}
