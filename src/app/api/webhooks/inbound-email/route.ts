import { NextResponse, type NextRequest } from "next/server";
import { Webhook } from "svix";
import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/server";
import { htmlToText, parseQuotedHistory, stripQuotedReply } from "@/lib/text";
import { aiModelInUse, analyzeInboundEmail } from "@/lib/ai";

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

// Pull every attachment for an email out of Resend's receiving API, upload to
// Supabase Storage, and insert metadata rows. Returns the inserted attachment
// ids so we can log progress.
type AttachmentMeta = { id?: string; filename?: string; content_type?: string };

async function persistAttachments(args: {
  emailId: string;
  rowEmailId: string;
  topicId: string | null;
  fromEnvelope: AnyObj[];
  fromFetched: AnyObj[];
}): Promise<number> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return 0;

  const resend = new Resend(apiKey);
  const attApi = (resend.emails as unknown as {
    receiving?: {
      attachments?: {
        get?: (
          options: { emailId: string; id: string },
        ) => Promise<{ data?: AnyObj | null; error?: unknown }>;
        list?: (
          options: { emailId: string },
        ) => Promise<{ data?: AnyObj | null; error?: unknown }>;
      };
    };
  }).receiving?.attachments;

  if (!attApi?.get) {
    console.warn(
      "inbound-email: receiving.attachments.get unavailable — upgrade resend SDK",
    );
    return 0;
  }

  // Reconcile attachment list: webhook envelope first, then receiving.get
  // payload, finally fall back to attachments.list if both were empty but the
  // email is known to have files.
  const seen = new Map<string, AttachmentMeta>();
  for (const a of [...args.fromEnvelope, ...args.fromFetched]) {
    const id = String((a as AnyObj).id ?? "");
    if (!id) continue;
    if (!seen.has(id)) {
      seen.set(id, {
        id,
        filename: typeof a.filename === "string" ? a.filename : undefined,
        content_type:
          typeof a.content_type === "string"
            ? a.content_type
            : typeof a.contentType === "string"
            ? a.contentType
            : undefined,
      });
    }
  }

  if (seen.size === 0 && attApi.list) {
    try {
      const listed = await attApi.list({ emailId: args.emailId });
      const items = (listed.data as { data?: AnyObj[] } | null)?.data ?? [];
      for (const a of items) {
        const id = String((a as AnyObj).id ?? "");
        if (!id) continue;
        seen.set(id, {
          id,
          filename: typeof a.filename === "string" ? a.filename : undefined,
          content_type:
            typeof a.content_type === "string" ? a.content_type : undefined,
        });
      }
    } catch (e) {
      console.error("inbound-email: attachments.list threw", e);
    }
  }

  if (seen.size === 0) return 0;

  console.log("inbound-email: attachments found", { count: seen.size });

  const supabase = createAdminClient();
  let saved = 0;

  for (const meta of seen.values()) {
    if (!meta.id) continue;
    try {
      const res = await attApi.get({ emailId: args.emailId, id: meta.id });
      if (res.error) {
        console.error("inbound-email: attachment fetch error", res.error);
        continue;
      }
      const d = (res.data ?? {}) as AnyObj;

      // The SDK's content can show up in a few shapes; try them in order.
      let buf: Buffer | null = null;
      const content = d.content;
      if (Buffer.isBuffer(content)) {
        buf = content;
      } else if (content instanceof Uint8Array) {
        buf = Buffer.from(content);
      } else if (typeof content === "string") {
        // base64 by convention
        buf = Buffer.from(content, "base64");
      } else if (typeof d.content_url === "string" || typeof d.url === "string") {
        const url = (d.content_url as string) ?? (d.url as string);
        const r = await fetch(url, { cache: "no-store" });
        if (r.ok) buf = Buffer.from(await r.arrayBuffer());
      }

      if (!buf) {
        console.error("inbound-email: couldn't extract attachment content", {
          attachmentId: meta.id,
          keys: Object.keys(d),
        });
        continue;
      }

      const filename = (d.filename as string) ?? meta.filename ?? `${meta.id}.bin`;
      const contentType =
        (d.content_type as string) ?? meta.content_type ?? "application/octet-stream";
      const safeName = filename.replace(/[^a-zA-Z0-9._-]+/g, "_");
      const path = `${args.rowEmailId}/${meta.id}-${safeName}`;

      const { error: upErr } = await supabase.storage
        .from("email-attachments")
        .upload(path, buf, {
          contentType,
          upsert: true,
        });
      if (upErr) {
        console.error("inbound-email: storage upload failed", upErr);
        continue;
      }

      const { error: insErr } = await supabase.from("attachments").insert({
        email_id: args.rowEmailId,
        topic_id: args.topicId,
        storage_path: path,
        filename,
        content_type: contentType,
        size_bytes: buf.byteLength,
      });
      if (insErr) {
        console.error("inbound-email: attachments insert failed", insErr);
        continue;
      }

      saved++;
    } catch (e) {
      console.error("inbound-email: attachment processing threw", e);
    }
  }

  console.log("inbound-email: attachments saved", { saved, of: seen.size });
  return saved;
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
  // Resend's webhook fires for both inbound (email.received) and outbound
  // delivery events (email.sent, email.delivered, email.bounced, etc.).
  // We only handle inbound — every outbound event would otherwise create a
  // spurious emails row, burn AI tokens, and pollute the inbox.
  const eventType = typeof payload.type === "string" ? payload.type : "";
  const isInboundEvent =
    eventType === "email.received" ||
    eventType === "inbound.received" ||
    eventType.startsWith("inbound.");

  if (!isInboundEvent) {
    console.log("inbound-email: ignoring non-inbound event", { type: eventType });
    return NextResponse.json({ ok: true, ignored: eventType });
  }

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

  // Derive plain-text from HTML when the email arrived HTML-only (Gmail's
  // default), or when the text part is just whitespace.
  if (!text.trim() && html) {
    text = htmlToText(html);
    console.log("inbound-email: derived text from html", { textLen: text.length });
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
  // When the thread points at an existing topic but the sender changed the
  // subject, treat it as a fresh topic — board members often "reply all" to
  // an old thread to start a new vote. Carrying over the old quoted history
  // in that case would clutter the new topic with stale context.
  let topicId: string | null = null;
  let subjectDivergedFromThread = false;
  const cleanedSubject = (subject || "").replace(/^\s*(re|fw|fwd):\s*/i, "").trim();
  const ancestorIds = [inReplyTo, ...referencesIds].filter((x): x is string => !!x);
  if (ancestorIds.length) {
    const { data: parent } = await supabase
      .from("emails")
      .select("topic_id")
      .in("message_id", ancestorIds)
      .not("topic_id", "is", null)
      .limit(1)
      .maybeSingle();
    if (parent?.topic_id) {
      const { data: parentTopic } = await supabase
        .from("topics")
        .select("id,title")
        .eq("id", parent.topic_id)
        .maybeSingle();
      const parentTitle = (parentTopic?.title ?? "").trim().toLowerCase();
      const subjMatches =
        !!cleanedSubject &&
        !!parentTitle &&
        cleanedSubject.toLowerCase() === parentTitle;
      // Accept empty/missing subject as "same thread" — replies without a
      // subject change still belong to the parent topic.
      if (!cleanedSubject || subjMatches) {
        topicId = parent.topic_id;
      } else {
        subjectDivergedFromThread = true;
      }
    }
  }
  if (!topicId && !subjectDivergedFromThread && subject) {
    if (cleanedSubject) {
      const { data: topic } = await supabase
        .from("topics")
        .select("id")
        .ilike("title", cleanedSubject)
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
    subjectDivergedFromThread,
    via: subjectDivergedFromThread
      ? "thread-diverged-new-subject"
      : ancestorIds.length && !topicAutoCreated
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
    const { newContent, newContentAuthor, newContentDate, history } =
      parseQuotedHistory(text);

    // Backfill quoted history first, oldest-first, dated to "before received".
    // Skip when the new topic was spawned because the sender changed the
    // subject on an existing thread — the quoted text belongs to the prior
    // topic and would be stale context here.
    if (topicAutoCreated && !subjectDivergedFromThread && history.length) {
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

      // Always use synthetic timestamps for ordering — parser order is
      // reliable (deeper quote = older), and mixing parsed dates with
      // synthetic ones produced inconsistent ordering when only some
      // attributions had parseable dates. The original parsed date (if any)
      // goes into original_date for display.
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
        original_date: h.date,
        // Spread oldest→newest in the seconds just before received_at so
        // they sort correctly relative to each other and the new message.
        created_at: new Date(baseMs - (history.length - i) * 1000).toISOString(),
      }));
      const { error: histErr } = await supabase.from("topic_messages").insert(rows);
      if (histErr) console.error("inbound-email: history backfill failed", histErr);
      else console.log("inbound-email: backfilled history", { count: rows.length });
    }

    // The new content message. Try the parsed "new content" first, then a
    // raw strip, then the bare text, then fall through to the subject.
    const body =
      newContent ||
      stripQuotedReply(text) ||
      text.trim() ||
      subject ||
      "(no message)";

    // When newContent was promoted from a wrapping forwarded segment, the
    // body is really the inner author's content. Look them up in the
    // roster so attribution lands on the right person; otherwise keep
    // their name/email on the row.
    let authorProfileId = profile?.id ?? null;
    let authorEmail = profile ? null : from.email;
    let authorName = profile ? null : from.name;
    if (newContentAuthor?.email) {
      const { data: matched } = await supabase
        .from("profiles")
        .select("id")
        .ilike("email", newContentAuthor.email)
        .maybeSingle();
      authorProfileId = matched?.id ?? null;
      authorEmail = matched ? null : newContentAuthor.email;
      authorName = matched ? null : (newContentAuthor.name ?? null);
    } else if (newContentAuthor?.name) {
      authorProfileId = null;
      authorEmail = null;
      authorName = newContentAuthor.name;
    }

    console.log("inbound-email: conversation body", {
      newContentLen: newContent.length,
      historyCount: history.length,
      finalBodyLen: body.length,
      promotedAuthor: newContentAuthor?.email ?? newContentAuthor?.name ?? null,
    });
    await supabase
      .from("topic_messages")
      .insert({
        topic_id: topicId,
        author_profile_id: authorProfileId,
        author_email: authorEmail,
        author_name: authorName,
        body_text: body,
        body_html: html || null,
        source: "email",
        email_id: inserted.id,
        extracted: false,
        original_date: newContentDate
          ? new Date(newContentDate).toISOString()
          : null,
        created_at: receivedAt,
      })
      .select("id")
      .maybeSingle();
  }

  // Persist any attachments. Best-effort: failures are logged but never
  // poison the webhook response (Resend would retry indefinitely).
  if (inserted && resendEmailId) {
    const envelopeAtt = Array.isArray(data.attachments)
      ? (data.attachments as AnyObj[])
      : [];
    const fetchedAtt = fetchedRaw && Array.isArray((fetchedRaw as AnyObj).attachments)
      ? ((fetchedRaw as AnyObj).attachments as AnyObj[])
      : [];
    try {
      await persistAttachments({
        emailId: resendEmailId,
        rowEmailId: inserted.id,
        topicId,
        fromEnvelope: envelopeAtt,
        fromFetched: fetchedAtt,
      });
    } catch (e) {
      console.error("inbound-email: persistAttachments threw", e);
    }
  }

  // AI analysis. Sync but best-effort — failures or missing key just skip.
  if (inserted && process.env.OPENROUTER_API_KEY) {
    try {
      const { data: openTopics } = await supabase
        .from("topics")
        .select("id,title,description")
        .eq("status", "open");

      const currentTopic = topicId
        ? (openTopics ?? []).find((t) => t.id === topicId) ?? null
        : null;

      let threadMessages: Array<{ author: string; body: string; date: string }> = [];
      if (topicId) {
        const { data: msgs } = await supabase
          .from("topic_messages")
          .select("author_name,author_email,author_profile_id,body_text,created_at,original_date")
          .eq("topic_id", topicId)
          .order("created_at", { ascending: true });
        // Hydrate profile names so the model has real names to attribute.
        const profileIds = Array.from(
          new Set(
            (msgs ?? [])
              .map((m) => m.author_profile_id)
              .filter((x): x is string => !!x),
          ),
        );
        const profileMap = new Map<string, string>();
        if (profileIds.length) {
          const { data: profs } = await supabase
            .from("profiles")
            .select("id,full_name,email")
            .in("id", profileIds);
          for (const p of profs ?? []) {
            profileMap.set(p.id, p.full_name ?? p.email);
          }
        }
        threadMessages = (msgs ?? []).map((m) => ({
          author:
            (m.author_profile_id && profileMap.get(m.author_profile_id)) ||
            m.author_name ||
            m.author_email ||
            "Unknown",
          body: m.body_text,
          date: m.original_date ?? m.created_at,
        }));
      }

      const { analysis, payload } = await analyzeInboundEmail({
        email: { from: from.email, subject: subject || null, body: text },
        currentTopic,
        thread: threadMessages,
        openTopics: openTopics ?? [],
      });

      // Always persist the payload (even on error) so admins can see what
      // the model actually received from /inbox/[id].
      await supabase
        .from("emails")
        .update({ ai_input: payload as unknown as object })
        .eq("id", inserted.id);

      if (analysis) {
        const finalTopicId = topicId ?? analysis.topic_id;

        await supabase
          .from("emails")
          .update({
            ai_summary: analysis.summary || null,
            ai_suggested_vote: analysis.vote,
            ai_suggested_topic_id: analysis.topic_id,
            ai_confidence: analysis.confidence,
            ai_reasoning: analysis.reasoning || null,
            ai_model: aiModelInUse(),
            ai_processed_at: new Date().toISOString(),
          })
          .eq("id", inserted.id);

        // Auto-apply the vote when:
        //  - confidence >= 0.9
        //  - AI suggested an actual vote (not "none")
        //  - sender is matched to a member (so we know who voted)
        //  - we have a topic to attach the vote to
        if (
          analysis.confidence >= 0.9 &&
          analysis.vote !== "none" &&
          profile?.id &&
          finalTopicId
        ) {
          const { error: voteErr } = await supabase.from("votes").upsert(
            {
              topic_id: finalTopicId,
              voter_id: profile.id,
              choice: analysis.vote,
              source: "ai",
              voted_by: null,
              email_id: inserted.id,
              notes: `AI (${Math.round(analysis.confidence * 100)}%): ${analysis.summary}`,
            },
            { onConflict: "topic_id,voter_id" },
          );
          if (voteErr) {
            console.error("inbound-email: AI vote upsert failed", voteErr);
          } else {
            await supabase
              .from("emails")
              .update({ processed: true, topic_id: finalTopicId })
              .eq("id", inserted.id);
            console.log("inbound-email: AI auto-applied vote", {
              vote: analysis.vote,
              confidence: analysis.confidence,
            });
          }
        }
      }
    } catch (e) {
      console.error("inbound-email: AI analysis threw", e);
    }
  }

  return NextResponse.json({ ok: true, topicId, autoCreated: topicAutoCreated });
}
