import { headers } from "next/headers";

// Resolves the public base URL of this deployment.
//
// Order of preference:
//   1. The actual request's forwarded host headers — works on any deploy
//      (Vercel, custom domain, previews, local) with zero env config and
//      will never disagree with what the user just clicked from.
//   2. NEXT_PUBLIC_SITE_URL, but only if it points somewhere real
//      (a localhost value is ignored when we're clearly not on localhost).
//   3. VERCEL_URL (set by Vercel for every deployment).
//   4. http://localhost:3000 fallback.
export async function getBaseUrl(): Promise<string> {
  let requestHost: string | null = null;
  let requestProto: string | null = null;

  try {
    const h = await headers();
    requestHost = h.get("x-forwarded-host") ?? h.get("host");
    requestProto = h.get("x-forwarded-proto");
  } catch {
    // headers() throws outside of a request scope.
  }

  if (requestHost) {
    const proto =
      requestProto ??
      (requestHost.startsWith("localhost") || requestHost.startsWith("127.")
        ? "http"
        : "https");
    return `${proto}://${requestHost}`;
  }

  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "");
  if (explicit && !/localhost|127\./.test(explicit)) return explicit;

  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}
