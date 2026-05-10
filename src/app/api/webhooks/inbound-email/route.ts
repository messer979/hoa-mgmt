import { NextResponse, type NextRequest } from "next/server";
import { Webhook } from "svix";
import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/server";
import { parseQuotedHistory, stripQuotedReply } from "@/lib/text";

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

// Resend's inbound webhook payload is just an envelope — body text/html is
// NOT included (per Resend docs: "Webhooks do not include the email body,
// headers, or attachments, only their metadata. You must call the Received
// emails API to retrieve them."). The official SDK call is
// `resend.emails.receiving.get(email_id)`.
async function fetchInboundBody(
  emailId: string,
): Promise<{ text: string; html: string; raw: AnyObj } | null> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;

  const resend = new Resend(apiKey);
  // Cast: the receiving namespace was added in a recent SDK version and may
  // not be in the type defs we're pinned to.
  const receiving = (resend.emails as unknown as {
    receiving?: { get: (id: string) => Promise<{ data?: AnyObj | null; error?: unknown }> };
  }).receiving;

  if (!receiving?.get) {
    console.error(
      "inbound-email: resend.emails.receiving.get is unavailable — upgrade the resend SDK (npm i resend@latest)",
    );
    return null;
  }

  try {
    const result = await receiving.get(emailId);
    if (result.error) {
      console.error("inbound-email: receiving.get error", result.error);
      return null;
    }
    const data = (result.data ?? {}) as AnyObj;
    const text = pickBodyText(data);
    const html = pickBodyHtml(data);
    console.log("inbound-email: fetched body via SDK", {
      keys: Object.keys(data),
      textLen: text.length,
      htmlLen: html.length,
    });
    if (text || html) return { text, html, raw: data };
    return { text: "", html: "", raw: data };
  } catch (e) {
    console.error("inbound-email: receiving.get threw", e);
    return null;
  }
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
  let text = pickBodyText(data);
  let html = pickBodyHtml(data);
  let fetchedRaw: AnyObj | null = null;

  // Resend's inbound webhook envelope omits body content; fetch it on demand
  // using the email_id from the payload.
  const resendEmailId =
    (typeof data.email_id === "string" && data.email_id) ||
    (typeof data.id === "string" && data.id) ||
    null;
  if (!text && !html && resendEmailId) {
    const fetched = await fetchInboundBody(resendEmailId);
    if (fetched) {
      text = fetched.text;
      html = fetched.html;
      fetchedRaw = fetched.raw;
    } else {
      console.warn("inbound-email: body fetch returned nothing", { resendEmailId });
    }
  }

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
    resendEmailId,
    subjectLen: subject.length,
    textLen: text.length,
    htmlLen: html.length,
    bodyFetched: !!fetchedRaw,
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

  // Auto-create a topic when the email looks like a brand-new discussion.
  // Two cases: (a) net-new email with a clean subject and no parent on file,
  // (b) CC'd onto a mid-flight thread we've never seen. We only do this when
  // the sender is a known member, so spam to the inbound address still lands
  // in /inbox for admin triage rather than spawning junk topics.
  let topicAutoCreated = false;
  if (!topicId && profile) {
    const cleanedSubject = (subject || "").replace(/^\s*(re|fw|fwd):\s*/i, "").trim();
    const title = cleanedSubject || `(no subject) from ${from.email}`;
    const { data: newTopic, error: topicErr } = await supabase
      .from("topics")
      .insert({
        title,
        description: null,
        created_by: profile.id,
        status: "open",
      })
      .select("id")
      .single();
    if (topicErr) {
      console.error("inbound-email: auto-create topic failed", topicErr);
    } else {
      topicId = newTopic!.id;
      topicAutoCreated = true;
    }
  }

  console.log("inbound-email: resolved", {
    matchedProfile: profile?.id ?? null,
    topicId,
    autoCreated: topicAutoCreated,
    via: ancestorIds.length
      ? "thread-headers"
      : subject && !topicAutoCreated
      ? "subject-fallback"
      : topicAutoCreated
      ? "auto-create"
      : "none",
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
      raw: { envelope: payload, fetched: fetchedRaw } as unknown as object,
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

  if (topicId && inserted) {
    const { newContent, history } = parseQuotedHistory(text);

    // Backfill quoted history first, oldest-first, dated to "before received".
    if (topicAutoCreated && history.length) {
      // Try to map each historical author email to a profile in one round-trip.
      const emails = Array.from(
        new Set(history.map((h) => h.author_email).filter((e): e is string => !!e)),
      );
      const profileByEmail = new Map<string, string>();
      if (emails.length) {
        const { data: matched } = await supabase
          .from("profiles")
          .select("id,email")
          .in("email", emails);
        for (const p of matched ?? []) {
          if (p.email) profileByEmail.set(p.email.toLowerCase(), p.id);
        }
      }

      // Spread historical timestamps just before the received_at so chrono
      // ordering is correct in the conversation view.
      const baseMs = new Date(receivedAt).getTime();
      const rows = history.map((h, i) => ({
        topic_id: topicId,
        author_profile_id:
          h.author_email ? profileByEmail.get(h.author_email.toLowerCase()) ?? null : null,
        author_email: h.author_email,
        author_name: h.author_name,
        body_text: h.body || "(empty)",
        body_html: null,
        source: "email" as const,
        email_id: null,
        extracted: true,
        // Use parsed date if present, otherwise nudge each older message back
        // by 1 second so they sort oldest→newest before the new one.
        created_at:
          h.date ?? new Date(baseMs - (history.length - i) * 1000).toISOString(),
      }));
      const { error: histErr } = await supabase.from("topic_messages").insert(rows);
      if (histErr) console.error("inbound-email: history backfill failed", histErr);
      else console.log("inbound-email: backfilled history", { count: rows.length });
    }

    // The new content message.
    const body = newContent || stripQuotedReply(text) || subject || "(no message)";
    await supabase
      .from("topic_messages")
      .insert({
        topic_id: topicId,
        author_profile_id: profile?.id ?? null,
        author_email: profile ? null : from.email,
        author_name: profile ? null : from.name,
        body_text: body,
        body_html: html || null,
        source: "email",
        email_id: inserted.id,
        extracted: false,
        created_at: receivedAt,
      })
      .select("id")
      .maybeSingle();
  }

  return NextResponse.json({ ok: true, topicId, autoCreated: topicAutoCreated });
}
