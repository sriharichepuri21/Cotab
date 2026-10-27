/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone", // Vercel/Docker-friendly; self-contained .next/standalone dir
  // FastAPI intentionally uses trailing slashes on collection routes. In local
  // same-origin/mobile-proxy mode, let those URLs reach it unchanged.
  skipTrailingSlashRedirect: true,
  // E2E dev-server artifacts must not collide with a preceding production build.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Signed-in pages moved under /app in the redesign; keep old bookmarks working.
  async redirects() {
    return [
      { source: "/budgets", destination: "/app/budgets", permanent: true },
      { source: "/groups/:path*", destination: "/app/groups/:path*", permanent: true },
      { source: "/receipts/:path*", destination: "/app/receipts/:path*", permanent: true },
    ];
  },
  async rewrites() {
    const api = process.env.DEV_API_PROXY_TARGET;
    if (!api) return [];
    return [
      // Preserve FastAPI collection-route slashes; dropping them makes
      // FastAPI redirect the browser to the private 127.0.0.1 upstream.
      { source: "/api/:path*/", destination: `${api}/api/:path*/` },
      { source: "/api/:path*", destination: `${api}/api/:path*` },
      { source: "/health", destination: `${api}/health` },
    ];
  },
};

module.exports = nextConfig;
