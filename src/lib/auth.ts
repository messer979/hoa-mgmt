import { cookies } from "next/headers";
import { createHash, timingSafeEqual } from "node:crypto";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

const AUTH_COOKIE = "hoa_auth";
const USER_COOKIE = "hoa_user";
// 1 year. Middleware refreshes the expiry on every authenticated request, so
// active users effectively never need to re-enter the password.
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function appPassword(): string {
  const pw = process.env.APP_PASSWORD;
  if (!pw) throw new Error("APP_PASSWORD is not set");
  return pw;
}

// Token = sha256("hoa-auth:" + password). Stored as the auth cookie value.
// Anyone holding the password can produce this; without it the cookie can't
// be forged. Rotating APP_PASSWORD invalidates every existing session.
function expectedToken(): string {
  return createHash("sha256").update("hoa-auth:" + appPassword()).digest("hex");
}

function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function checkPassword(input: string): boolean {
  return safeEq(input, appPassword());
}

export async function isAuthed(): Promise<boolean> {
  const c = await cookies();
  const t = c.get(AUTH_COOKIE)?.value;
  if (!t) return false;
  return safeEq(t, expectedToken());
}

const cookieOpts = () =>
  ({
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });

export async function setAuthCookie() {
  const c = await cookies();
  c.set(AUTH_COOKIE, expectedToken(), cookieOpts());
}

export async function setUserCookie(profileId: string) {
  const c = await cookies();
  c.set(USER_COOKIE, profileId, cookieOpts());
}

export async function clearSession() {
  const c = await cookies();
  c.delete(AUTH_COOKIE);
  c.delete(USER_COOKIE);
}

export async function getCurrentProfile(): Promise<Profile | null> {
  if (!(await isAuthed())) return null;
  const c = await cookies();
  const id = c.get(USER_COOKIE)?.value;
  if (!id) return null;
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as Profile | null) ?? null;
}

export async function requireUser(): Promise<Profile> {
  const me = await getCurrentProfile();
  if (!me) redirect(await isAuthed() ? "/whoami" : "/login");
  return me;
}

export async function requireAdmin(): Promise<Profile> {
  const me = await requireUser();
  if (me.role !== "admin") redirect("/topics");
  return me;
}
