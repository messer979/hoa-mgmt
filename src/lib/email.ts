import { Resend } from "resend";
import { getBaseUrl } from "@/lib/site";

let _resend: Resend | null = null;
function client() {
  if (!_resend) {
    if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY not set");
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
}

let _warnedNoInbound = false;
function replyTo(): string | undefined {
  const v = process.env.RESEND_INBOUND_ADDRESS;
  if (!v && !_warnedNoInbound) {
    _warnedNoInbound = true;
    console.warn(
      "RESEND_INBOUND_ADDRESS is not set — outbound emails will have no Reply-To, " +
        "so member replies will go to RESEND_FROM_EMAIL (a sending-only domain) " +
        "and never reach the /api/webhooks/inbound-email webhook. " +
        "Configure Resend Inbound and set this env var.",
    );
  }
  return v || undefined;
}

export type SendResult = {
  /** Resend's message id, normalized to "<id@host>" RFC 5322 form. */
  messageId: string | null;
  /** Raw value Resend returned (no angle brackets). */
  rawId: string | null;
};

function normalizeMessageId(id: string | null | undefined): string | null {
  if (!id) return null;
  return id.startsWith("<") ? id : `<${id}>`;
}

export async function sendTopicAnnouncement(args: {
  to: string[];
  topicId: string;
  title: string;
  descriptionHtml: string | null;
  descriptionText: string | null;
  closesAt: string | null;
}): Promise<SendResult> {
  const from = process.env.RESEND_FROM_EMAIL;
  if (!from) throw new Error("RESEND_FROM_EMAIL not set");

  const baseUrl = await getBaseUrl();
  const link = `${baseUrl}/topics/${args.topicId}`;

  const text = [
    `New vote: ${args.title}`,
    "",
    args.descriptionText ?? "",
    "",
    `Reply YES / NO / ABSTAIN to record your vote, or open ${link}`,
    args.closesAt ? `Closes ${new Date(args.closesAt).toLocaleString()}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const html = `
    <div style="font-family: system-ui, -apple-system, sans-serif; line-height:1.5;">
      <h2 style="margin:0 0 8px">${escapeHtml(args.title)}</h2>
      ${args.descriptionHtml ? `<div>${args.descriptionHtml}</div>` : ""}
      <p>
        Reply <b>YES</b> / <b>NO</b> / <b>ABSTAIN</b> to record your vote,
        or <a href="${link}">open the topic</a>.
      </p>
      ${args.closesAt ? `<p style="color:#666">Closes ${new Date(args.closesAt).toLocaleString()}</p>` : ""}
    </div>
  `;

  const res = await client().emails.send({
    from,
    to: args.to,
    replyTo: replyTo(),
    subject: args.title,
    text,
    html,
  });
  const rawId = res.data?.id ?? null;
  return { rawId, messageId: normalizeMessageId(rawId) };
}

export type ThreadHistoryItem = {
  author: string;
  date: Date;
  bodyText: string;
};

export async function sendThreadReply(args: {
  to: string[];
  topicId: string;
  topicTitle: string;
  bodyText: string;
  authorName: string | null;
  inReplyTo: string | null;
  references: string[];
  /** Prior messages on this topic, newest-first, to quote as a Gmail-style history block. */
  history?: ThreadHistoryItem[];
}): Promise<SendResult> {
  const from = process.env.RESEND_FROM_EMAIL;
  if (!from) throw new Error("RESEND_FROM_EMAIL not set");

  const baseUrl = await getBaseUrl();
  const link = `${baseUrl}/topics/${args.topicId}`;
  const subject = args.topicTitle.startsWith("Re:")
    ? args.topicTitle
    : `Re: ${args.topicTitle}`;

  const attribution = args.authorName ? `${args.authorName} wrote:` : "Someone wrote:";

  const fmtDate = (d: Date) =>
    d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  const historyText = (args.history ?? [])
    .map((h) => {
      const quoted = (h.bodyText || "").split("\n").map((l) => "> " + l).join("\n");
      return `On ${fmtDate(h.date)}, ${h.author} wrote:\n${quoted}`;
    })
    .join("\n\n");

  const historyHtml = (args.history ?? [])
    .map(
      (h) =>
        `<div style="margin-top:12px;color:#555;font-size:13px">` +
        `<div>On ${escapeHtml(fmtDate(h.date))}, ${escapeHtml(h.author)} wrote:</div>` +
        `<blockquote style="margin:6px 0 0 .8ex;border-left:1px solid #ccc;padding:0 0 0 1ex;color:#555;white-space:pre-wrap">` +
        `${escapeHtml(h.bodyText || "")}` +
        `</blockquote></div>`,
    )
    .join("");

  const text = [
    args.bodyText.trim(),
    "",
    "—",
    `${attribution} (via the board website — ${link})`,
    historyText ? `\n${historyText}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const html = `
    <div style="font-family: system-ui, -apple-system, sans-serif; line-height:1.5;">
      <p style="white-space:pre-wrap">${escapeHtml(args.bodyText)}</p>
      <hr style="border:none;border-top:1px solid #ddd;margin:12px 0" />
      <p style="color:#666;font-size:12px">
        ${escapeHtml(attribution)}
        Sent via the board website — <a href="${link}">${link}</a>
      </p>
      ${historyHtml}
    </div>
  `;

  const headers: Record<string, string> = {};
  if (args.inReplyTo) headers["In-Reply-To"] = args.inReplyTo;
  if (args.references.length) headers["References"] = args.references.join(" ");

  const res = await client().emails.send({
    from,
    to: args.to,
    replyTo: replyTo(),
    subject,
    text,
    html,
    headers,
  });
  const rawId = res.data?.id ?? null;
  return { rawId, messageId: normalizeMessageId(rawId) };
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendInvite(args: {
  to: string;
  link: string;
  recipientName: string | null;
}): Promise<SendResult> {
  const from = process.env.RESEND_FROM_EMAIL;
  if (!from) throw new Error("RESEND_FROM_EMAIL not set");

  const baseUrl = await getBaseUrl();
  const greeting = args.recipientName ? `Hi ${args.recipientName},` : "Hi,";
  const text = [
    greeting,
    "",
    "You've been added to the HOA Board app — a small site for tracking discussions and votes that used to happen over email.",
    "",
    "Click below to sign in. This first link expires in 30 minutes, but you can always grab a new one at any time:",
    "",
    args.link,
    "",
    `Site: ${baseUrl}`,
  ].join("\n");

  const html = `
    <div style="font-family: system-ui, -apple-system, sans-serif; line-height:1.5;">
      <p>${escapeHtml(greeting)}</p>
      <p>
        You've been added to the HOA Board app — a small site for tracking
        discussions and votes that used to happen over email.
      </p>
      <p>
        Click below to sign in. This first link expires in 30 minutes, but you
        can always grab a new one at any time.
      </p>
      <p>
        <a href="${args.link}"
           style="display:inline-block;padding:10px 16px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;font-weight:500">
          Sign in
        </a>
      </p>
      <p style="color:#666;font-size:12px">
        Or paste this URL: <a href="${args.link}">${escapeHtml(args.link)}</a>
        <br/>
        Site: <a href="${baseUrl}">${escapeHtml(baseUrl)}</a>
      </p>
    </div>
  `;

  const res = await client().emails.send({
    from,
    to: [args.to],
    replyTo: replyTo(),
    subject: "You're invited to the HOA board",
    text,
    html,
  });
  const rawId = res.data?.id ?? null;
  return { rawId, messageId: normalizeMessageId(rawId) };
}

export async function sendMagicLink(args: {
  to: string;
  link: string;
  recipientName: string | null;
}): Promise<SendResult> {
  const from = process.env.RESEND_FROM_EMAIL;
  if (!from) throw new Error("RESEND_FROM_EMAIL not set");

  const greeting = args.recipientName ? `Hi ${args.recipientName},` : "Hi,";
  const text = [
    greeting,
    "",
    "Click the link below to sign in to the HOA board app:",
    "",
    args.link,
    "",
    "This link expires in 30 minutes and can only be used once. If you didn't request it, you can ignore this email.",
  ].join("\n");

  const html = `
    <div style="font-family: system-ui, -apple-system, sans-serif; line-height:1.5;">
      <p>${escapeHtml(greeting)}</p>
      <p>Click the button below to sign in to the HOA board app:</p>
      <p>
        <a href="${args.link}"
           style="display:inline-block;padding:10px 16px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;font-weight:500">
          Sign in
        </a>
      </p>
      <p style="color:#666;font-size:12px">
        Or paste this URL: <a href="${args.link}">${escapeHtml(args.link)}</a><br/>
        This link expires in 30 minutes and can only be used once.
        If you didn't request it, you can ignore this email.
      </p>
    </div>
  `;

  const res = await client().emails.send({
    from,
    to: [args.to],
    replyTo: replyTo(),
    subject: "Sign in to the HOA board",
    text,
    html,
  });
  const rawId = res.data?.id ?? null;
  return { rawId, messageId: normalizeMessageId(rawId) };
}
