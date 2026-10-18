// Theme: 'dark' (default), 'light' or 'system'. Saved on this device.
// An inline script in app/layout.js applies it before the first paint; ThemeSync keeps it in step.
export const THEME_KEY = 'opus-theme';
export const BG = { dark: '#12110d', light: '#f8f3e6' };

export function readTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'light' || v === 'system') return v;
  } catch {}
  return 'dark';
}

export function resolveTheme(mode) {
  if (mode === 'system') return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  return mode === 'light' ? 'light' : 'dark';
}

function setMeta(name, content) {
  let m = document.querySelector(`meta[name="${name}"]`);
  if (!m) {
    m = document.createElement('meta');
    m.name = name;
    document.head.appendChild(m);
  }
  m.content = content;
}

export function applyTheme(mode, save) {
  const t = resolveTheme(mode);
  const el = document.documentElement;
  const scheme = t === 'light' ? 'only light' : 'dark';
  el.dataset.theme = t;
  el.style.colorScheme = scheme;
  setMeta('theme-color', BG[t]);
  setMeta('color-scheme', scheme);
  if (save) {
    try {
      localStorage.setItem(THEME_KEY, mode);
    } catch {}
  }
}
