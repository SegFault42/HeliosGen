import path from "node:path";
import type { NextConfig } from "next";

// The packaged desktop (Tauri) build runs `next build` with DESKTOP_BUILD=1 and
// ships the self-contained `.next/standalone` server as a bundled sidecar. Plain
// `next dev` / `next build` (local development) leave it unset.
const DESKTOP_BUILD = process.env.DESKTOP_BUILD === "1";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.64.2"],
  ...(DESKTOP_BUILD ? { output: "standalone" as const } : {}),
  turbopack: {
    root: path.join(__dirname),
  },
  experimental: {
    proxyClientMaxBodySize: '30mb',
  },
  serverExternalPackages: ["undici"],
  // Stored media never changes under the same name (uuid / hash-suffixed files),
  // so the browser may keep it instead of revalidating every image and video on
  // each visit. Matches what app/generated/[...path]/route.ts already sends.
  async headers() {
    return [
      {
        source: "/generated/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
  // `sharp` is a native module; the file tracer misses its platform binaries
  // unless we point at them explicitly for the standalone bundle.
  outputFileTracingIncludes: {
    "/**": ["node_modules/sharp/**/*", "node_modules/@img/**/*"],
  },
  // Never trace the Tauri desktop staging area into the standalone output.
  outputFileTracingExcludes: {
    "/**": ["src-tauri/**/*"],
  },
  images: {
    qualities: [30, 75],
    // Sources are immutable, so a thumbnail is valid for as long as its file
    // exists. The 4 h default re-encoded every multi-MB original several times a day.
    minimumCacheTTL: 31536000,
    remotePatterns: [
      // Read-only public bucket holding the bundled workflow-template sample media
      // (lib/templates.ts). Not app storage — just an image CDN allow-list entry.
      { protocol: "https", hostname: "*.r2.dev" },
      { protocol: "https", hostname: "*.replicate.delivery" },
      { protocol: "https", hostname: "pbxt.replicate.delivery" },
      { protocol: "https", hostname: "*.replicate.com" },
      { protocol: "https", hostname: "*.aiquickdraw.com" },
    ],
  },
};

export default nextConfig;
