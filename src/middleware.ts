import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "hoa_session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const cookieOpts = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: COOKIE_MAX_AGE,
};

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPublic =
    pathname === "/login" ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/api/webhooks");

  const session = request.cookies.get(SESSION_COOKIE)?.value;

  let response: NextResponse;
  if (!session && !isPublic) {
    response = NextResponse.redirect(new URL("/login", request.url));
  } else {
    response = NextResponse.next();
  }

  // Sliding session: re-issue the cookie with a fresh expiry on every request
  // that arrives with one, so active users effectively never log out.
  // (HMAC verification happens server-side via lib/auth.ts.)
  if (session) {
    response.cookies.set(SESSION_COOKIE, session, cookieOpts);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
