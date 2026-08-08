/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone", // Vercel/Docker-friendly; self-contained .next/standalone dir
};

module.exports = nextConfig;
