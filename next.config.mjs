/** @type {import('next').NextConfig} */
const nextConfig = {
  // ── Redirects: old /movie/:id → /embed/movie/:id ─────────────────────────
  async redirects() {
    return [
      { source: '/movie/:id', destination: '/embed/movie/:id', permanent: true },
      { source: '/movie/:id/', destination: '/embed/movie/:id', permanent: true },
      { source: '/tv/:id/:season/:episode', destination: '/embed/tv/:id/:season/:episode', permanent: true },
    ];
  },

  // ── Security + Cloudflare-friendly headers ─────────────────────────────────
  async headers() {
    return [
      {
        // Embed pages — allow iframing from anywhere (iframe embed product)
        source: '/embed/:path*',
        headers: [
          { key: 'X-Frame-Options',         value: 'ALLOWALL' },
          { key: 'Content-Security-Policy', value: "frame-ancestors *" },
          { key: 'Cache-Control',           value: 'public, max-age=0, must-revalidate' },
        ],
      },
      {
        // Proxy responses — Cloudflare caches HLS segments for 1h
        source: '/api/proxy',
        headers: [
          { key: 'Cache-Control', value: 'public, s-maxage=3600, stale-while-revalidate=300' },
          { key: 'Access-Control-Allow-Origin', value: '*' },
        ],
      },
      {
        // Provider APIs — never cache (signed URLs expire fast)
        source: '/api/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store' },
          { key: 'Access-Control-Allow-Origin', value: '*' },
        ],
      },
    ];
  },

  // ── Image optimization ────────────────────────────────────────────────────
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'image.tmdb.org' }],
  },

  // ── Performance ───────────────────────────────────────────────────────────
  compress: true,
  poweredByHeader: false,
};

export default nextConfig;
