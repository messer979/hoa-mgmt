import { createClient as createAdminBase } from "@supabase/supabase-js";

// Service-role client. RLS is locked down (no policies); we never expose the
// anon key to the browser, so all DB access goes through this on the server.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env vars missing");
  return createAdminBase(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
