import { NextResponse, type NextRequest } from "next/server";

// Cheap cookie check — full validation happens in server components.
// We can't run node:crypto reliably in the edge middleware, so we just gate
// "auth cookie present"; the actual HMAC compare is enforced server-side.
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPublic =
    pathname === "/login" ||
    pathname.startsWith("/api/webhooks") ||
    pathname.startsWith("/auth/signout");

  const hasAuth = !!request.cookies.get("hoa_auth");
  const hasUser = !!request.cookies.get("hoa_user");

  if (!hasAuth && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (hasAuth && !hasUser && !isPublic && pathname !== "/whoami") {
    const url = request.nextUrl.clone();
    url.pathname = "/whoami";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
