import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // 26mb leaves headroom over the 25mb storage cap on email-attachments
    // so manual uploads near the limit don't 413 in the server action.
    serverActions: { bodySizeLimit: "26mb" },
  },
  // pg has native bindings; keep it out of the server bundle so
  // instrumentation.ts can load it at runtime.
  serverExternalPackages: ["pg"],
};

export default nextConfig;
