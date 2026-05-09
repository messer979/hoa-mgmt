import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { adminProxyVote } from "../../topics/actions";
import {
  linkEmailToTopic,
  linkEmailToProfile,
  markProcessed,
} from "../actions";
import type { Choice } from "@/lib/types";

export const dynamic = "force-dynamic";

function guessChoice(text: string | null): Choice | null {
  if (!text) return null;
  const t = text.toLowerCase();
  const body = t.split(/\n\s*on .* wrote:|\n\s*-----original message-----/i)[0];
  if (/\b(yes|aye|approve|approved|affirm|in favor|for it|i agree)\b/.test(body)) return "affirm";
  if (/\b(no|nay|reject|rejected|deny|denied|against|opposed|disagree)\b/.test(body)) return "reject";
  if (/\babstain\b/.test(body)) return "abstain";
  return null;
}

export default async function EmailDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const supabase = createAdminClient();
  const { data: email } = await supabase
    .from("emails").select("*").eq("id", id).maybeSingle();
  if (!email) notFound();

  const [{ data: topics }, { data: profiles }] = await Promise.all([
    supabase.from("topics").select("id,title,status").order("created_at", { ascending: false }),
    supabase.from("profiles").select("id,full_name,email").order("full_name"),
  ]);

  const matched = profiles?.find((p) => p.id === email.matched_profile_id);
  const linkedTopic = topics?.find((t) => t.id === email.topic_id);
  const guessed = guessChoice(email.body_text);

  return (
    <div className="space-y-5">
      <Link href="/inbox" className="text-sm text-muted hover:underline">← Inbox</Link>

      <header className="card">
        <h1 className="text-lg font-semibold">{email.subject || "(no subject)"}</h1>
        <div className="text-xs text-muted mt-1">
          From {email.from_name ? `${email.from_name} <${email.from_email}>` : email.from_email}
          {" · "}
          {new Date(email.received_at).toLocaleString()}
        </div>
        <div className="mt-2 flex items-center gap-2 text-xs">
          {email.processed ? (
            <span className="badge text-emerald-700 border-emerald-600">processed</span>
          ) : (
            <span className="badge">new</span>
          )}
          {matched ? (
            <span className="badge">sender: {matched.full_name ?? matched.email}</span>
          ) : (
            <span className="badge text-amber-700 border-amber-600">unknown sender</span>
          )}
          {linkedTopic && (
            <span className="badge">topic: {linkedTopic.title}</span>
          )}
          {guessed && (
            <span className="badge">guessed: {guessed}</span>
          )}
        </div>
      </header>

      <section className="card">
        <h2 className="font-medium mb-2">Message</h2>
        <pre className="whitespace-pre-wrap text-sm leading-relaxed font-sans">
          {email.body_text || "(no plain text body)"}
        </pre>
      </section>

      {!matched && (
        <section className="card">
          <h2 className="font-medium mb-2">Match sender to a member</h2>
          <form action={linkEmailToProfile} className="flex items-center gap-2">
            <input type="hidden" name="id" value={email.id} />
            <select name="profile_id" className="input flex-1">
              <option value="">— Select a member —</option>
              {(profiles ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {(p.full_name ?? p.email)} · {p.email}
                </option>
              ))}
            </select>
            <button className="btn">Save</button>
          </form>
        </section>
      )}

      {!linkedTopic && (
        <section className="card">
          <h2 className="font-medium mb-2">Link to a topic</h2>
          <form action={linkEmailToTopic} className="flex items-center gap-2">
            <input type="hidden" name="id" value={email.id} />
            <select name="topic_id" className="input flex-1">
              <option value="">— Select a topic —</option>
              {(topics ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title} ({t.status})
                </option>
              ))}
            </select>
            <button className="btn">Save</button>
          </form>
        </section>
      )}

      {matched && (
        <section className="card">
          <h2 className="font-medium mb-2">Record vote on behalf of {matched.full_name ?? matched.email}</h2>
          <form action={adminProxyVote} className="space-y-2">
            <input type="hidden" name="voter_id" value={matched.id} />
            <input type="hidden" name="email_id" value={email.id} />
            <div>
              <label className="label">Topic</label>
              <select name="topic_id" required defaultValue={email.topic_id ?? ""} className="input">
                <option value="" disabled>— Choose a topic —</option>
                {(topics ?? []).filter((t) => t.status === "open").map((t) => (
                  <option key={t.id} value={t.id}>{t.title}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Choice</label>
              <div className="flex items-center gap-2">
                {(["affirm", "reject", "abstain"] as Choice[]).map((c) => (
                  <label key={c} className="inline-flex items-center gap-1 text-sm">
                    <input
                      type="radio"
                      name="choice"
                      value={c}
                      defaultChecked={guessed === c}
                      required
                    />
                    {c[0].toUpperCase() + c.slice(1)}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="label" htmlFor="notes">Notes (optional)</label>
              <textarea id="notes" name="notes" className="input" rows={2} />
            </div>
            <button className="btn-primary">Record proxy vote &amp; mark processed</button>
          </form>
        </section>
      )}

      <section className="card flex items-center gap-2">
        <form action={markProcessed}>
          <input type="hidden" name="id" value={email.id} />
          <input type="hidden" name="processed" value={email.processed ? "false" : "true"} />
          <button className="btn">
            {email.processed ? "Mark as new" : "Mark processed (no vote)"}
          </button>
        </form>
      </section>
    </div>
  );
}
