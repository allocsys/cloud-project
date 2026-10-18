/** @type {import('next').NextConfig} */
const nextConfig = {
  // Set by the Dockerfile only, so `next start` on Railway keeps working as before.
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  async headers() {
    return [
      {
        // Always re-check the service worker so updates reach installed apps.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};
export default nextConfig;
