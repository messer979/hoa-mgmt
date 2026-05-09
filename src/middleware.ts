import { NextResponse, type NextRequest } from "next/server";

const AUTH_COOKIE = "hoa_auth";
const USER_COOKIE = "hoa_user";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

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
    pathname.startsWith("/api/webhooks") ||
    pathname.startsWith("/auth/signout");

  const auth = request.cookies.get(AUTH_COOKIE)?.value;
  const user = request.cookies.get(USER_COOKIE)?.value;

  let response: NextResponse;
  if (!auth && !isPublic) {
    response = NextResponse.redirect(new URL("/login", request.url));
  } else if (auth && !user && !isPublic && pathname !== "/whoami") {
    response = NextResponse.redirect(new URL("/whoami", request.url));
  } else {
    response = NextResponse.next();
  }

  // Sliding session: re-issue any present cookie with a fresh expiry, so that
  // every visit pushes logout 1 year out. The HMAC compare still happens
  // server-side via lib/auth.ts.
  if (auth) response.cookies.set(AUTH_COOKIE, auth, cookieOpts);
  if (user) response.cookies.set(USER_COOKIE, user, cookieOpts);

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
