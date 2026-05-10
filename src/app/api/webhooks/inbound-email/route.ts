import { NextResponse, type NextRequest } from "next/server";
import { Webhook } from "svix";
import { createAdminClient } from "@/lib/supabase/server";
import { stripQuotedReply } from "@/lib/text";

export const runtime = "nodejs";

type AnyObj = Record<string, unknown>;
type InboundPayload = {
  type?: string;
  data?: AnyObj;
} & AnyObj;

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

function readHeader(data: AnyObj, ...names: string[]): string | null {
  for (const name of names) {
    const camel = name.toLowerCase().replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    const snake = name.toLowerCase().replace(/-/g, "_");
    const direct = (data as AnyObj)[camel] ?? (data as AnyObj)[snake];
    if (typeof direct === "string" && direct.trim()) return direct.trim();
    const headers = (data as { headers?: AnyObj }).headers;
    if (headers && typeof headers === "object") {
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === name.toLowerCase()) {
          const v = headers[key];
          if (typeof v === "string" && v.trim()) return v.trim();
          if (Array.isArray(v) && v.length && typeof v[0] === "string") return v[0].trim();
        }
      }
    }
  }
  return null;
}

function readReferences(data: AnyObj): string[] {
  const v =
    (data as AnyObj).references ??
    (data as { headers?: AnyObj }).headers?.["References"] ??
    (data as { headers?: AnyObj }).headers?.["references"];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string") return v.split(/\s+/).filter(Boolean);
  return [];
}

function asString(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.length && typeof v[0] === "string") return v[0];
  return "";
}

// Reach into nested objects to find a string at a path.
function dig(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const k of path) {
    if (cur && typeof cur === "object" && k in (cur as AnyObj)) {
      cur = (cur as AnyObj)[k];
    } else {
      return undefined;
    }
  }
  return cur;
}

// Try a bunch of field shapes Resend / common email parsers have used.
function pickBodyText(data: AnyObj): string {
  const candidates: unknown[] = [
    data.text,
    data.bodyText,
    data.body_text,
    data.plainText,
    dig(data, ["body", "text"]),
    dig(data, ["body", "plain"]),
    dig(data, ["email", "text"]),
    dig(data, ["message", "text"]),
    dig(data, ["parsed", "text"]),
  ];

  // Also scan an array of parts: { contentType: "text/plain", body | content }
  const parts =
    (Array.isArray(data.parts) && data.parts) ||
    (Array.isArray(data.bodyParts) && data.bodyParts) ||
    [];
  for (const p of parts as AnyObj[]) {
    const ct = String(p?.contentType ?? p?.content_type ?? p?.mimeType ?? "");
    if (ct.toLowerCase().includes("text/plain")) {
      candidates.push(p.body, p.content, p.text);
    }
  }

  for (const c of candidates) {
    const s = asString(c);
    if (s.trim()) return s;
  }
  return "";
}

function pickBodyHtml(data: AnyObj): string {
  const candidates: unknown[] = [
    data.html,
    data.bodyHtml,
    data.body_html,
    dig(data, ["body", "html"]),
    dig(data, ["email", "html"]),
    dig(data, ["message", "html"]),
    dig(data, ["parsed", "html"]),
  ];
  const parts =
    (Array.isArray(data.parts) && data.parts) ||
    (Array.isArray(data.bodyParts) && data.bodyParts) ||
    [];
  for (const p of parts as AnyObj[]) {
    const ct = String(p?.contentType ?? p?.content_type ?? p?.mimeType ?? "");
    if (ct.toLowerCase().includes("text/html")) {
      candidates.push(p.body, p.content, p.html);
    }
  }
  for (const c of candidates) {
    const s = asString(c);
    if (s.trim()) return s;
  }
  return "";
}

function pickSubject(data: AnyObj): string {
  return asString(
    data.subject ??
      dig(data, ["headers", "Subject"]) ??
      dig(data, ["headers", "subject"]) ??
      dig(data, ["email", "subject"]) ??
      dig(data, ["message", "subject"])
  );
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
    payload = JSON.parse(raw) as InboundPayload;
  }

  // Resend sends a variety of event types: outbound delivery events
  // (email.sent, email.delivered, email.bounced, …) plus inbound events
  // (inbound.received / inbound.email / similar). Only process events that
  // actually carry a parsed message body — everything else is logged and
  // acknowledged so Resend stops retrying.
  const data = (payload.data ?? {}) as AnyObj;
  const subject = pickSubject(data);
  const text = pickBodyText(data);
  const html = pickBodyHtml(data);

  // Heuristic: process anything that looks like a parsed message. Otherwise
  // ack and skip non-message events (e.g. delivery notifications).
  const looksLikeMessage =
    typeof data.from !== "undefined" &&
    (subject.length > 0 || text.length > 0 || html.length > 0);

  if (!looksLikeMessage) {
    console.log("inbound-email: ignoring non-message event", {
      type: payload.type,
      payloadKeys: Object.keys(payload),
      dataKeys: Object.keys(data),
    });
    return NextResponse.json({ ok: true, ignored: payload.type ?? "unknown" });
  }

  console.log("inbound-email: extracted", {
    dataKeys: Object.keys(data),
    subjectLen: subject.length,
    textLen: text.length,
    htmlLen: html.length,
  });

  const from = pickAddress(data.from);
  const to = pickFirstAddress(data.to);
  const messageId = readHeader(data, "Message-ID", "messageId", "message_id");
  const inReplyTo = readHeader(data, "In-Reply-To", "inReplyTo", "in_reply_to");
  const referencesIds = readReferences(data);
  const receivedRaw = data.received_at;
  const receivedAt =
    typeof receivedRaw === "string"
      ? new Date(receivedRaw).toISOString()
      : new Date().toISOString();

  if (!from.email) {
    console.warn("inbound-email: payload missing from address", {
      type: payload.type,
      dataKeys: Object.keys(data),
    });
    return NextResponse.json({ ok: false, error: "missing from address" }, { status: 400 });
  }

  console.log("inbound-email: received", {
    type: payload.type,
    from: from.email,
    subject,
    messageId,
    inReplyTo,
    referencesCount: referencesIds.length,
  });

  const supabase = createAdminClient();

  // Match the sender to a known member (case-insensitive).
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .ilike("email", from.email)
    .maybeSingle();

  // Resolve topic by walking the thread first, then falling back to subject.
  let topicId: string | null = null;
  const ancestorIds = [inReplyTo, ...referencesIds].filter((x): x is string => !!x);
  if (ancestorIds.length) {
    const { data: parent } = await supabase
      .from("emails")
      .select("topic_id")
      .in("message_id", ancestorIds)
      .not("topic_id", "is", null)
      .limit(1)
      .maybeSingle();
    if (parent?.topic_id) topicId = parent.topic_id;
  }
  if (!topicId && subject) {
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

  console.log("inbound-email: resolved", {
    matchedProfile: profile?.id ?? null,
    topicId,
    via: ancestorIds.length ? "thread-headers" : subject ? "subject-fallback" : "none",
  });

  const { data: inserted, error } = await supabase
    .from("emails")
    .insert({
      message_id: messageId,
      from_email: from.email,
      from_name: from.name,
      to_email: to.email || null,
      subject: subject || null,
      body_text: text || null,
      body_html: html || null,
      matched_profile_id: profile?.id ?? null,
      topic_id: topicId,
      in_reply_to: inReplyTo,
      references_ids: referencesIds.length ? referencesIds : null,
      is_outbound: false,
      raw: payload as unknown as object,
      received_at: receivedAt,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      // duplicate message_id — treat as success so Resend stops retrying
      return NextResponse.json({ ok: true, duplicate: true });
    }
    console.error("inbound-email insert failed", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // If we know the topic, materialize the conversation message now.
  if (topicId && inserted) {
    const stripped = stripQuotedReply(text) || (subject || "(no message)");
    await supabase
      .from("topic_messages")
      .insert({
        topic_id: topicId,
        author_profile_id: profile?.id ?? null,
        body_text: stripped,
        body_html: html || null,
        source: "email",
        email_id: inserted.id,
        created_at: receivedAt,
      })
      .select("id")
      .maybeSingle();
  }

  return NextResponse.json({ ok: true });
}
