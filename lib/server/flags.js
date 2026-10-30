// Site switches the admin can flip. They live in the meta entry "flags" (shared with mockCharts, see telemetry.js).
//
//   showDemo   true (the default) shows "Explore the demo first" on the sign-in sheet; false hides it. Admin > Settings > Demo account.
//              This only hides the button. To close demo access completely also set REQUIRE_AUTH=1.
import { warm, metaGet, metaUpdate } from '@/lib/server/db';

export async function showDemo() {
  await warm();
  return metaGet('flags')?.showDemo !== false;
}

export function setShowDemo(on) {
  return metaUpdate('flags', (cur) => ({ value: { ...(cur || {}), showDemo: !!on }, result: !!on }));
}
