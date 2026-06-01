import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.64.2"],
  experimental: {
    proxyClientMaxBodySize: '30mb',
  },
  serverExternalPackages: ["undici"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.r2.dev" },
      { protocol: "https", hostname: "**.r2.dev" },
      { protocol: "https", hostname: "*.replicate.delivery" },
      { protocol: "https", hostname: "pbxt.replicate.delivery" },
      { protocol: "https", hostname: "*.replicate.com" },
    ],
  },
};

export default nextConfig;
