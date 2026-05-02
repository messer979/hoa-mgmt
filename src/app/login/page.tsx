"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/callback`;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });
    setLoading(false);
    if (error) setErr(error.message);
    else setSent(true);
  }

  return (
    <main className="min-h-screen grid place-items-center p-6">
      <div className="card w-full max-w-sm">
        <h1 className="text-xl font-semibold mb-1">HOA Board</h1>
        <p className="text-sm text-muted mb-4">Sign in with your board email.</p>
        {sent ? (
          <p className="text-sm">Check your inbox for a magic link.</p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input
                id="email"
                className="input"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <button className="btn-primary w-full" disabled={loading}>
              {loading ? "Sending…" : "Send magic link"}
            </button>
            {err && <p className="text-sm text-rose-600">{err}</p>}
          </form>
        )}
      </div>
    </main>
  );
}
