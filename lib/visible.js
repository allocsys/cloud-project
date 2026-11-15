// Runs `fn` every `ms` while the tab is visible, and once more when the tab comes back.
// A hidden tab does no work. Returns the cleanup function.
export function everyVisible(fn, ms) {
  const id = setInterval(() => {
    if (!document.hidden) fn();
  }, ms);
  const onShow = () => {
    if (!document.hidden) fn();
  };
  document.addEventListener('visibilitychange', onShow);
  return () => {
    clearInterval(id);
    document.removeEventListener('visibilitychange', onShow);
  };
}
