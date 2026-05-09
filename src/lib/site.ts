import { headers } from "next/headers";

// Resolves the public base URL of this deployment without requiring an env
// var. Order of preference:
//   1. NEXT_PUBLIC_SITE_URL (explicit override)
//   2. Forwarded host headers from the current request
//   3. VERCEL_URL (set by Vercel on every deployment)
//   4. localhost fallback
export async function getBaseUrl(): Promise<string> {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");

  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host) {
      const proto =
        h.get("x-forwarded-proto") ??
        (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
      return `${proto}://${host}`;
    }
  } catch {
    // headers() throws outside of a request scope (e.g. background work).
  }

  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}
