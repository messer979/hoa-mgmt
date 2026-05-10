import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { adminProxyVote } from "../../topics/actions";
import {
  applyAISuggestion,
  linkEmailToTopic,
  linkEmailToProfile,
  markProcessed,
  reparseEmailHistory,
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

      {email.ai_processed_at && (
        <section className="card border-l-4 border-l-violet-500">
          <div className="flex items-center gap-2 mb-2">
            <h2 className="font-medium">AI analysis</h2>
            {email.ai_model && (
              <span className="text-xs text-muted">{email.ai_model}</span>
            )}
            {typeof email.ai_confidence === "number" && (
              <span className="badge text-xs">
                {Math.round(email.ai_confidence * 100)}% confident
              </span>
            )}
          </div>
          {email.ai_summary && <p className="text-sm">{email.ai_summary}</p>}
          {email.ai_reasoning && (
            <p className="text-xs text-muted mt-2">{email.ai_reasoning}</p>
          )}
          {(email as { ai_input?: unknown }).ai_input ? (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer text-muted">
                View payload sent to model
              </summary>
              <pre className="mt-2 whitespace-pre-wrap text-xs bg-muted/10 p-2 rounded overflow-auto max-h-72">
                {JSON.stringify((email as { ai_input?: unknown }).ai_input, null, 2)}
              </pre>
            </details>
          ) : null}
          {email.ai_suggested_vote && email.ai_suggested_vote !== "none" && (
            <div className="mt-3 pt-3 border-t border-border flex items-center gap-3 flex-wrap">
              <span className="text-sm">
                Suggested vote:{" "}
                <strong className={
                  email.ai_suggested_vote === "affirm"
                    ? "text-emerald-700"
                    : email.ai_suggested_vote === "reject"
                    ? "text-rose-700"
                    : ""
                }>
                  {email.ai_suggested_vote}
                </strong>
              </span>
              {email.processed ? (
                <span className="badge text-emerald-700 border-emerald-600">
                  applied
                </span>
              ) : matched ? (
                <form action={applyAISuggestion}>
                  <input type="hidden" name="id" value={email.id} />
                  <button className="btn-primary !py-1 !text-sm">
                    Apply suggestion
                  </button>
                </form>
              ) : (
                <span className="text-xs text-muted">
                  Match the sender below to enable apply.
                </span>
              )}
            </div>
          )}
        </section>
      )}

      <section className="card">
        <h2 className="font-medium mb-2">Message</h2>
        <pre className="whitespace-pre-wrap text-sm leading-relaxed font-sans">
          {email.body_text || "(no plain text body)"}
        </pre>
        {email.body_html && (
          <details className="mt-3 text-xs">
            <summary className="cursor-pointer text-muted">HTML body</summary>
            <pre className="mt-2 whitespace-pre-wrap text-xs bg-muted/10 p-2 rounded overflow-auto max-h-64">
              {email.body_html}
            </pre>
          </details>
        )}
        {email.raw && (
          <details className="mt-3 text-xs">
            <summary className="cursor-pointer text-muted">
              Raw payload (debug)
            </summary>
            <pre className="mt-2 whitespace-pre-wrap text-xs bg-muted/10 p-2 rounded overflow-auto max-h-96">
              {JSON.stringify(email.raw, null, 2)}
            </pre>
          </details>
        )}
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

      <section className="card flex items-center gap-2 flex-wrap">
        <form action={markProcessed}>
          <input type="hidden" name="id" value={email.id} />
          <input type="hidden" name="processed" value={email.processed ? "false" : "true"} />
          <button className="btn">
            {email.processed ? "Mark as new" : "Mark processed (no vote)"}
          </button>
        </form>
        {email.topic_id && (
          <form action={reparseEmailHistory}>
            <input type="hidden" name="id" value={email.id} />
            <button className="btn" title="Re-run the quoted-history parser on this email's body and rebuild the conversation messages.">
              Re-parse history
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
