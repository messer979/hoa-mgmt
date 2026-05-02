import { Resend } from "resend";

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
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const link = `${site}/topics/${args.topicId}`;

  const text = [
    `New vote: ${args.title}`,
    "",
    args.description ?? "",
    "",
    `Reply YES / NO / ABSTAIN to record your vote, or open ${link}`,
    args.closesAt ? `Closes ${new Date(args.closesAt).toLocaleString()}` : "",
  ].join("\n");

  return client().emails.send({
    from,
    to: args.to,
    replyTo: process.env.RESEND_INBOUND_ADDRESS,
    subject: args.title,
    text,
  });
}
