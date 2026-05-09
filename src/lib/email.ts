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

export async function sendTopicAnnouncement(args: {
  to: string[];
  topicId: string;
  title: string;
  description: string | null;
  closesAt: string | null;
}) {
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

  return client().emails.send({
    from,
    to: args.to,
    replyTo: process.env.RESEND_INBOUND_ADDRESS,
    subject: args.title,
    text,
    html,
  });
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
