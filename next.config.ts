import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // 26mb leaves headroom over the 25mb storage cap on email-attachments
    // so manual uploads near the limit don't 413 in the server action.
    serverActions: { bodySizeLimit: "26mb" },
  },
  // pg (and its transitive deps like pgpass) has native bindings and touches
  // Node built-ins. Keep the whole family out of Next's server bundle so
  // instrumentation.ts loads them via plain require at runtime.
  serverExternalPackages: ["pg", "pg-native", "pgpass", "pg-connection-string"],
  webpack: (config, { isServer }) => {
    // The client bundle should never load pg, but Next traces
    // instrumentation.ts's dynamic import and can pull pgpass into the
    // client graph, where `require('fs')` fails to resolve. Stub the Node
    // built-ins to `false` so the reference is silently dropped.
    if (!isServer) {
      config.resolve.fallback = {
        ...(config.resolve.fallback ?? {}),
        fs: false,
        net: false,
        tls: false,
        dns: false,
        "pg-native": false,
      };
    }
    return config;
  },
};

export default nextConfig;
