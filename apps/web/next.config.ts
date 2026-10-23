import type { NextConfig } from "next";

// Single .env at the repo root is shared by web, worker and scripts.
try {
  process.loadEnvFile("../../.env");
} catch {
  // Absent in production, where real environment variables are injected.
}

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Native / Node-only dependencies of @tsq/core stay outside the server bundle.
  serverExternalPackages: ["sharp", "@resvg/resvg-js", "@node-rs/argon2", "pg", "bullmq", "ioredis"],
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
