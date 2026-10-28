/** @type {import('next').NextConfig} */
// Pages that are not for search results: the signed-in app, the sign-in screens, the admin and the API.
const PRIVATE = ['dashboard', 'miners', 'plans', 'wallet', 'referrals', 'notifications', 'settings', 'login', 'verify', 'admin', 'api'];
const nextConfig = {
  // Set by the Dockerfile only, so `next start` on Railway keeps working as before.
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  async headers() {
    return [
      {
        // Basic security headers on every page.
        source: '/:path*',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      {
        // Always re-check the service worker so updates reach installed apps.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      ...PRIVATE.map((p) => ({
        source: `/${p}/:path*`,
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      })),
    ];
  },
};
export default nextConfig;
