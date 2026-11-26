// Runs `fn` every `ms` while the tab is visible, and once more when the tab comes back, unless it already ran within the last `ms`
// (switching tabs back and forth must not fire a burst of requests). A hidden tab does no work. Returns the cleanup function.
export function everyVisible(fn, ms) {
  let last = Date.now();
  const run = () => {
    last = Date.now();
    fn();
  };
  const id = setInterval(() => {
    if (!document.hidden) run();
  }, ms);
  const onShow = () => {
    if (!document.hidden && Date.now() - last >= ms) run();
  };
  document.addEventListener('visibilitychange', onShow);
  return () => {
    clearInterval(id);
    document.removeEventListener('visibilitychange', onShow);
  };
}
