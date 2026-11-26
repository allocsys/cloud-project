// Tells the Android app that the page is ready, so its start-screen globe fades out (android-app/native/SphereView.java).
// Does nothing in a browser or in an older app.
export function hideNativeSplash() {
  try {
    const p = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NativeSplash;
    if (p && p.hide) Promise.resolve(p.hide()).catch(() => {});
  } catch {}
}
