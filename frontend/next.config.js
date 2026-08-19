/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone", // Vercel/Docker-friendly; self-contained .next/standalone dir
  // E2E dev-server artifacts must not collide with a preceding production build.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

module.exports = nextConfig;
