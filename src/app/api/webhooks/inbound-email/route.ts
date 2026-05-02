import { NextResponse, type NextRequest } from "next/server";
import { Webhook } from "svix";
import { createAdminClient } from "@/lib/supabase/server";

// Resend Inbound posts JSON; payload is signed with Svix headers.
// Docs: https://resend.com/docs/dashboard/webhooks/introduction
export const runtime = "nodejs";

type InboundPayload = {
  type?: string; // e.g. "email.received"
  data?: {
    from?: { email?: string; name?: string } | string;
    to?: Array<{ email?: string; name?: string } | string> | string;
    subject?: string;
    text?: string;
    html?: string;
    headers?: Record<string, string>;
    message_id?: string;
    messageId?: string;
    received_at?: string;
  };
} & Record<string, unknown>;

function pickAddress(v: unknown): { email: string; name: string | null } {
  if (typeof v === "string") return { email: v, name: null };
  if (v && typeof v === "object") {
    const o = v as { email?: string; name?: string };
    return { email: o.email ?? "", name: o.name ?? null };
  }
  return { email: "", name: null };
}

function pickFirstAddress(v: unknown) {
  if (Array.isArray(v) && v.length) return pickAddress(v[0]);
  return pickAddress(v);
}

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const raw = await req.text();

  let payload: InboundPayload;

  if (secret) {
    const headers = {
      "svix-id": req.headers.get("svix-id") ?? "",
      "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
      "svix-signature": req.headers.get("svix-signature") ?? "",
    };
    try {
      const wh = new Webhook(secret);
      payload = wh.verify(raw, headers) as InboundPayload;
    } catch (err) {
      console.error("inbound-email signature verify failed", err);
      return NextResponse.json({ ok: false, error: "invalid signature" }, { status: 401 });
    }
  } else {
    // Allow unsigned posts only when no secret is configured (e.g. local dev).
    payload = JSON.parse(raw) as InboundPayload;
  }

  if (payload.type && !payload.type.startsWith("email")) {
    return NextResponse.json({ ok: true, ignored: payload.type });
  }

  const data = payload.data ?? {};
  const from = pickAddress(data.from);
  const to = pickFirstAddress(data.to);
  const subject = (data.subject ?? "").toString();
  const text = (data.text ?? "").toString();
  const html = (data.html ?? "").toString();
  const messageId = (data.message_id ?? data.messageId ?? null) as string | null;
  const receivedAt = data.received_at ? new Date(data.received_at).toISOString() : new Date().toISOString();

  if (!from.email) {
    return NextResponse.json({ ok: false, error: "missing from address" }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Try to match the sender to a known member.
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .ilike("email", from.email)
    .maybeSingle();

  // Try to link to a topic by subject (e.g. "Re: <topic title>").
  let topicId: string | null = null;
  if (subject) {
    const cleaned = subject.replace(/^\s*(re|fw|fwd):\s*/i, "").trim();
    if (cleaned) {
      const { data: topic } = await supabase
        .from("topics")
        .select("id")
        .ilike("title", cleaned)
        .maybeSingle();
      if (topic) topicId = topic.id;
    }
  }

  const { error } = await supabase.from("emails").insert({
    message_id: messageId,
    from_email: from.email,
    from_name: from.name,
    to_email: to.email || null,
    subject: subject || null,
    body_text: text || null,
    body_html: html || null,
    matched_profile_id: profile?.id ?? null,
    topic_id: topicId,
    raw: payload as unknown as object,
    received_at: receivedAt,
  });

  if (error) {
    // Likely a duplicate message_id — treat as success so Resend doesn't retry forever.
    if (error.code === "23505") {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    console.error("inbound-email insert failed", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
