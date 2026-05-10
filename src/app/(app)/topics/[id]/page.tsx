import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { castVote, adminProxyVote, postReply, setTopicStatus } from "../actions";
import type { Choice, Profile, TopicMessage } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function TopicDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const me = await requireUser();
  const isAdmin = me.role === "admin";

  const supabase = createAdminClient();
  const { data: topic } = await supabase
    .from("topics")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!topic) notFound();

  const [{ data: profilesData }, { data: votesData }, { data: messagesData }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id,full_name,email,unit_number,role")
        .order("full_name", { ascending: true }),
      supabase
        .from("votes")
        .select("id,topic_id,voter_id,choice,source,voted_by,email_id,notes,created_at")
        .eq("topic_id", id),
      supabase
        .from("topic_messages")
        .select("id,topic_id,author_profile_id,body_text,body_html,source,email_id,created_at")
        .eq("topic_id", id)
        .order("created_at", { ascending: true }),
    ]);

  const profiles = (profilesData ?? []) as Pick<Profile, "id" | "full_name" | "email" | "unit_number" | "role">[];
  const votes = votesData ?? [];
  const messages = (messagesData ?? []) as TopicMessage[];

  // For email messages without a matched profile, look up the original email
  // row so we can show "Name <addr>" instead of "Unknown".
  const emailIdsToHydrate = messages
    .filter((m) => m.source === "email" && !m.author_profile_id)
    .map((m) => m.email_id)
    .filter((x): x is string => !!x);
  const emailFromMap = new Map<string, { from_name: string | null; from_email: string }>();
  if (emailIdsToHydrate.length) {
    const { data: rows } = await supabase
      .from("emails")
      .select("id,from_name,from_email")
      .in("id", emailIdsToHydrate);
    for (const r of rows ?? []) {
      emailFromMap.set(r.id, { from_name: r.from_name, from_email: r.from_email });
    }
  }
  const profileById = new Map(profiles.map((p) => [p.id, p]));

  function authorLabel(m: TopicMessage): string {
    if (m.author_profile_id) {
      const p = profileById.get(m.author_profile_id);
      if (p) return p.full_name ?? p.email;
    }
    if (m.email_id) {
      const e = emailFromMap.get(m.email_id);
      if (e) return e.from_name ? `${e.from_name} <${e.from_email}>` : e.from_email;
    }
    return "Unknown";
  }

  const myVote = votes.find((v) => v.voter_id === me.id);
  const tally = { affirm: 0, reject: 0, abstain: 0 } as Record<Choice, number>;
  for (const v of votes) tally[v.choice as Choice]++;

  const totalMembers = profiles.length;
  const voted = votes.length;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/topics" className="text-sm text-muted hover:underline">← All topics</Link>
        <h1 className="text-2xl font-semibold mt-1">{topic.title}</h1>
        <div className="mt-2 flex items-center gap-2 text-xs">
          <span className="badge">{topic.status}</span>
          {topic.closes_at && (
            <span className="text-muted">closes {new Date(topic.closes_at).toLocaleString()}</span>
          )}
        </div>
        {topic.description && (
          <p className="mt-3 whitespace-pre-wrap text-sm">{topic.description}</p>
        )}
      </div>

      <section className="card">
        <h2 className="font-medium mb-3">Your vote</h2>
        {topic.status !== "open" ? (
          <p className="text-sm text-muted">This topic is {topic.status}.</p>
        ) : (
          <form action={castVote} className="flex items-center gap-2">
            <input type="hidden" name="topic_id" value={topic.id} />
            {(["affirm", "reject", "abstain"] as Choice[]).map((c) => (
              <button
                key={c}
                name="choice"
                value={c}
                className={
                  c === "affirm"
                    ? "btn-affirm"
                    : c === "reject"
                    ? "btn-reject"
                    : "btn"
                }
              >
                {myVote?.choice === c ? "✓ " : ""}
                {c[0].toUpperCase() + c.slice(1)}
              </button>
            ))}
            {myVote && (
              <span className="text-xs text-muted ml-2">
                Currently: {myVote.choice} ({myVote.source})
              </span>
            )}
          </form>
        )}
      </section>

      <section className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium">Discussion</h2>
          <span className="text-xs text-muted">{messages.length} messages</span>
        </div>

        {messages.length === 0 ? (
          <p className="text-sm text-muted">
            No messages yet. Email replies and posts on this page will appear here.
          </p>
        ) : (
          <ol className="space-y-4">
            {messages.map((m) => (
              <li key={m.id} className="flex gap-3">
                <div
                  className="mt-1 h-8 w-8 rounded-full bg-muted/20 grid place-items-center text-xs"
                  aria-hidden
                >
                  {authorLabel(m).slice(0, 1).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <span className="font-medium text-fg">{authorLabel(m)}</span>
                    <span>·</span>
                    <span>{new Date(m.created_at).toLocaleString()}</span>
                    <span className="badge">{m.source}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{m.body_text}</p>
                </div>
              </li>
            ))}
          </ol>
        )}

        {topic.status === "open" && (
          <form action={postReply} className="mt-4 space-y-2 border-t border-border pt-4">
            <input type="hidden" name="topic_id" value={topic.id} />
            <label className="label" htmlFor="body">Reply</label>
            <textarea
              id="body"
              name="body"
              required
              className="input min-h-24"
              placeholder="Add to the discussion…"
            />
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" name="fan_out" defaultChecked />
                <span>Also email everyone</span>
              </label>
              <button className="btn-primary">Post reply</button>
            </div>
          </form>
        )}
      </section>

      <section className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium">Tally</h2>
          <span className="text-xs text-muted">{voted} of {totalMembers} voted</span>
        </div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-md bg-emerald-50 dark:bg-emerald-950 p-3">
            <div className="text-2xl font-semibold text-emerald-700">{tally.affirm}</div>
            <div className="text-xs">Affirm</div>
          </div>
          <div className="rounded-md bg-rose-50 dark:bg-rose-950 p-3">
            <div className="text-2xl font-semibold text-rose-700">{tally.reject}</div>
            <div className="text-xs">Reject</div>
          </div>
          <div className="rounded-md bg-muted/10 p-3">
            <div className="text-2xl font-semibold">{tally.abstain}</div>
            <div className="text-xs">Abstain</div>
          </div>
        </div>
      </section>

      <section className="card">
        <h2 className="font-medium mb-3">Roster</h2>
        <ul className="divide-y divide-border">
          {profiles.map((p) => {
            const v = votes.find((vv) => vv.voter_id === p.id);
            return (
              <li key={p.id} className="py-2 flex items-center gap-3">
                <div className="flex-1">
                  <div className="text-sm font-medium">{p.full_name ?? p.email}</div>
                  <div className="text-xs text-muted">
                    {p.email}{p.unit_number ? ` · Unit ${p.unit_number}` : ""}
                  </div>
                </div>
                <div className="text-sm">
                  {v ? (
                    <span className="badge">
                      {v.choice} · {v.source}
                    </span>
                  ) : (
                    <span className="text-muted text-xs">no vote</span>
                  )}
                </div>
                {isAdmin && topic.status === "open" && (
                  <form action={adminProxyVote} className="flex items-center gap-1">
                    <input type="hidden" name="topic_id" value={topic.id} />
                    <input type="hidden" name="voter_id" value={p.id} />
                    <select name="choice" className="input !py-1 !text-xs w-28" defaultValue={v?.choice ?? "affirm"}>
                      <option value="affirm">Affirm</option>
                      <option value="reject">Reject</option>
                      <option value="abstain">Abstain</option>
                    </select>
                    <button className="btn !py-1 !text-xs">Record</button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {isAdmin && (
        <section className="card">
          <h2 className="font-medium mb-3">Admin</h2>
          <form action={setTopicStatus} className="flex items-center gap-2">
            <input type="hidden" name="id" value={topic.id} />
            <select name="status" defaultValue={topic.status} className="input w-40">
              <option value="open">Open</option>
              <option value="closed">Closed</option>
              <option value="passed">Passed</option>
              <option value="failed">Failed</option>
            </select>
            <button className="btn">Update status</button>
          </form>
        </section>
      )}
    </div>
  );
}
