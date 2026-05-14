/** @type {import('next').NextConfig} */

// dev / 데모용 backend proxy 대상.
// 평소 dev에서는 NEXT_PUBLIC_API_URL이 절대경로(예: http://localhost:8002)로 박혀 있어서
// 브라우저가 직접 backend를 호출 — 이 rewrites는 사실상 무시됨.
// 데모 시(demo-tunnel.bat): NEXT_PUBLIC_API_URL=""로 띄우면 fetch가 same-origin("/api/...")으로 가고
// Next.js dev server가 받아서 아래 destination으로 proxy. cloudflared 1개 터널만으로 끝.
const BACKEND_PROXY = process.env.BACKEND_PROXY_URL || "http://localhost:8002";

const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${BACKEND_PROXY}/api/:path*` },
    ];
  },
};

module.exports = nextConfig;
