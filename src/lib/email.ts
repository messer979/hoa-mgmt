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
  description: string | null;
  closesAt: string | null;
}): Promise<SendResult> {
  const from = process.env.RESEND_FROM_EMAIL;
  if (!from) throw new Error("RESEND_FROM_EMAIL not set");

  const baseUrl = await getBaseUrl();
  const link = `${baseUrl}/topics/${args.topicId}`;

  const text = [
    `New vote: ${args.title}`,
    "",
    args.description ?? "",
    "",
    `Reply YES / NO / ABSTAIN to record your vote, or open ${link}`,
    args.closesAt ? `Closes ${new Date(args.closesAt).toLocaleString()}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const html = `
    <div style="font-family: system-ui, -apple-system, sans-serif; line-height:1.5;">
      <h2 style="margin:0 0 8px">${escapeHtml(args.title)}</h2>
      ${args.description ? `<p style="white-space:pre-wrap">${escapeHtml(args.description)}</p>` : ""}
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

export async function sendThreadReply(args: {
  to: string[];
  topicId: string;
  topicTitle: string;
  bodyText: string;
  authorName: string | null;
  inReplyTo: string | null;
  references: string[];
}): Promise<SendResult> {
  const from = process.env.RESEND_FROM_EMAIL;
  if (!from) throw new Error("RESEND_FROM_EMAIL not set");

  const baseUrl = await getBaseUrl();
  const link = `${baseUrl}/topics/${args.topicId}`;
  const subject = args.topicTitle.startsWith("Re:")
    ? args.topicTitle
    : `Re: ${args.topicTitle}`;

  const attribution = args.authorName ? `${args.authorName} wrote:` : "Someone wrote:";
  const text = [
    args.bodyText.trim(),
    "",
    "—",
    `${attribution} (via the board website — ${link})`,
  ].join("\n");

  const html = `
    <div style="font-family: system-ui, -apple-system, sans-serif; line-height:1.5;">
      <p style="white-space:pre-wrap">${escapeHtml(args.bodyText)}</p>
      <hr style="border:none;border-top:1px solid #ddd;margin:12px 0" />
      <p style="color:#666;font-size:12px">
        ${escapeHtml(attribution)}
        Sent via the board website — <a href="${link}">${link}</a>
      </p>
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
