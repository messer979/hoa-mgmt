import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { parseEventsFromText } from "@/lib/ai";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  await requireUser();

  let body: { text?: unknown; timezone?: unknown; nowIso?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  const timezone = typeof body.timezone === "string" ? body.timezone : "UTC";
  const nowIso = typeof body.nowIso === "string" ? body.nowIso : new Date().toISOString();

  if (!text) return NextResponse.json({ error: "text is required" }, { status: 400 });

  try {
    const events = await parseEventsFromText(text, { timezone, nowIso });
    return NextResponse.json({ events });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "parse failed";
    console.error("parse-events failed", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
