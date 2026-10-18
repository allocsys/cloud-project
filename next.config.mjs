/** @type {import('next').NextConfig} */
const nextConfig = {
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
