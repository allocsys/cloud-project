// True inside the Android app (a browser and an older shell without Capacitor say no).
export function inApp() {
  try {
    const c = window.Capacitor;
    return !!(c && ((c.isNativePlatform && c.isNativePlatform()) || (c.Plugins && c.Plugins.NativeSplash)));
  } catch {
    return false;
  }
}

// Tells the Android app that the page is ready, so its start-screen globe fades out (android-app/native/SphereView.java).
// Does nothing in a browser or in an older app.
export function hideNativeSplash() {
  try {
    const p = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NativeSplash;
    if (p && p.hide) Promise.resolve(p.hide()).catch(() => {});
  } catch {}
}
