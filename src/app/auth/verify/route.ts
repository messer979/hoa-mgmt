import { NextResponse, type NextRequest } from "next/server";
import { consumeMagicLink, setSessionCookie } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const result = await consumeMagicLink(token);

  if (!result.ok) {
    const url = req.nextUrl.clone();
    url.pathname = "/auth/error";
    url.search = `?reason=${encodeURIComponent(result.reason)}`;
    return NextResponse.redirect(url);
  }

  await setSessionCookie(result.profileId);
  const url = req.nextUrl.clone();
  url.pathname = "/topics";
  url.search = "";
  return NextResponse.redirect(url);
}
