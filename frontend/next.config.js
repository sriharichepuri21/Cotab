/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone", // Vercel/Docker-friendly; self-contained .next/standalone dir
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
};

module.exports = nextConfig;
