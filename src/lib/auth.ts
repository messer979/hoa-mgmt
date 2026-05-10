import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

const SESSION_COOKIE = "hoa_session";
// 1 year. Middleware refreshes the cookie on every authenticated request, so
// active users effectively never have to re-authenticate.
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const TOKEN_TTL_MIN = 30;

function sessionSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      "SESSION_SECRET is missing or too short. Set a random 32+ byte value in env.",
    );
  }
  return s;
}

function sign(profileId: string): string {
  return createHmac("sha256", sessionSecret())
    .update(`hoa-session:${profileId}`)
    .digest("base64url");
}

function packSession(profileId: string): string {
  return `${profileId}.${sign(profileId)}`;
}

export function unpackSession(value: string | undefined | null): string | null {
  if (!value) return null;
  const dot = value.indexOf(".");
  if (dot < 0) return null;
  const profileId = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!profileId || !sig) return null;

  let expected: string;
  try {
    expected = sign(profileId);
  } catch {
    return null;
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  return profileId;
}

const cookieOpts = () => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: COOKIE_MAX_AGE,
});

export async function setSessionCookie(profileId: string) {
  const c = await cookies();
  c.set(SESSION_COOKIE, packSession(profileId), cookieOpts());
}

export async function clearSession() {
  const c = await cookies();
  c.delete(SESSION_COOKIE);
}

export async function getCurrentProfile(): Promise<Profile | null> {
  const c = await cookies();
  const profileId = unpackSession(c.get(SESSION_COOKIE)?.value);
  if (!profileId) return null;
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", profileId)
    .maybeSingle();
  return (data as Profile | null) ?? null;
}

export async function requireUser(): Promise<Profile> {
  const me = await getCurrentProfile();
  if (!me) redirect("/login");
  return me;
}

export async function requireAdmin(): Promise<Profile> {
  const me = await requireUser();
  if (me.role !== "admin") redirect("/topics");
  return me;
}

// ---------- magic link issuance / consumption ----------

export type IssueResult =
  | { ok: true; profile: Profile; token: string }
  | { ok: false; reason: "not_in_roster" | "db_error"; error?: string };

export async function issueMagicLink(rawEmail: string): Promise<IssueResult> {
  const email = rawEmail.trim().toLowerCase();
  if (!email) return { ok: false, reason: "not_in_roster" };

  const supabase = createAdminClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .ilike("email", email)
    .maybeSingle();
  if (!profile) return { ok: false, reason: "not_in_roster" };

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expires = new Date(Date.now() + TOKEN_TTL_MIN * 60 * 1000).toISOString();

  const { error } = await supabase.from("auth_tokens").insert({
    profile_id: profile.id,
    token_hash: tokenHash,
    expires_at: expires,
  });
  if (error) return { ok: false, reason: "db_error", error: error.message };

  return { ok: true, profile: profile as Profile, token };
}

export type ConsumeResult =
  | { ok: true; profileId: string }
  | {
      ok: false;
      reason: "missing" | "invalid" | "expired" | "already_used" | "db_error";
    };

export async function consumeMagicLink(rawToken: string): Promise<ConsumeResult> {
  if (!rawToken) return { ok: false, reason: "missing" };
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const supabase = createAdminClient();

  const { data: tok, error } = await supabase
    .from("auth_tokens")
    .select("id,profile_id,expires_at,consumed_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error) return { ok: false, reason: "db_error" };
  if (!tok) return { ok: false, reason: "invalid" };
  if (tok.consumed_at) return { ok: false, reason: "already_used" };
  if (new Date(tok.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }

  const { error: updateErr } = await supabase
    .from("auth_tokens")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", tok.id)
    .is("consumed_at", null); // race-safe single-use guard
  if (updateErr) return { ok: false, reason: "db_error" };

  return { ok: true, profileId: tok.profile_id };
}
