// Notifications are saved in English (title, body) and, for the ones the app writes itself, also with a code and values:
// n.code is 'welcome', 'wdSent', ... and n.vars holds what the text needs. The page then builds the text from the
// keys note.<code>.t and note.<code>.b. A notification without a code (older ones, or news an admin wrote) stays as saved.

function planName(n, t) {
  const k = `tier.${String(n).toLowerCase()}`;
  const v = t(k);
  return v === k ? n : v;
}

// A UTC day (milliseconds) as a short date: "12 Oct", with the language's month name and Latin digits.
export function dayText(ms, lang) {
  try {
    return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : `${lang}-u-ca-gregory-nu-latn`, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(ms);
  } catch {
    return '';
  }
}

function varsOf(n, t, lang) {
  const v = { ...(n.vars || {}) };
  if (v.who) v.who = t(`note.who${n.code === 'paused' ? 'P' : 'R'}.${v.who}`, v);
  if (v.tail) v.tail = t(`note.tail.${v.tail}`);
  if ('gift' in v) v.gift = v.gift ? ` ${t('note.gift')}` : '';
  if (v.plan) v.plan = planName(v.plan, t);
  if (v.day != null) v.date = dayText(v.day, lang);
  return v;
}

export function noteTitle(n, t, lang) {
  return n.code ? t(`note.${n.code}.t`, varsOf(n, t, lang)) : n.title;
}

// A Smart pause or resume decided under the floor rule carries vars.floor and uses the '.bs' text (market returns); older ones keep '.b'.
export function noteBody(n, t, lang) {
  if (!n.code) return n.body;
  const floor = (n.code === 'paused' || n.code === 'resumed') && n.vars?.floor === true;
  return t(`note.${n.code}.${floor ? 'bs' : 'b'}`, varsOf(n, t, lang));
}

// "Just now", "5m ago", "3h ago" and short dates, as the server wrote them.
export function noteWhen(n, t, lang) {
  const w = String(n.when ?? '');
  if (w === 'Just now') return t('hist.now');
  let m = /^(\d+)m ago$/.exec(w);
  if (m) return t('note.min', { n: m[1] });
  m = /^(\d+)h ago$/.exec(w);
  if (m) return t('note.hour', { n: m[1] });
  if (n.at && lang !== 'en') {
    try {
      return new Intl.DateTimeFormat(`${lang}-u-ca-gregory-nu-latn`, { day: 'numeric', month: 'short' }).format(n.at);
    } catch {
      return w;
    }
  }
  return w;
}
