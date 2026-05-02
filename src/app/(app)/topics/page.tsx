import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function TopicsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user!.id)
    .maybeSingle();
  const isAdmin = profile?.role === "admin";

  const { data: topics } = await supabase
    .from("topics")
    .select("id,title,description,status,closes_at,created_at")
    .order("created_at", { ascending: false });

  const ids = (topics ?? []).map((t) => t.id);
  const tallies: Record<string, { affirm: number; reject: number; abstain: number }> = {};
  if (ids.length) {
    const { data: votes } = await supabase
      .from("votes")
      .select("topic_id,choice")
      .in("topic_id", ids);
    for (const v of votes ?? []) {
      const t = (tallies[v.topic_id] ??= { affirm: 0, reject: 0, abstain: 0 });
      t[v.choice as "affirm" | "reject" | "abstain"]++;
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Topics</h1>
        {isAdmin && (
          <Link href="/topics/new" className="btn-primary">New topic</Link>
        )}
      </div>

      {(topics ?? []).length === 0 ? (
        <p className="text-sm text-muted">
          No topics yet.{isAdmin ? " Create one to start a vote." : ""}
        </p>
      ) : (
        <ul className="space-y-3">
          {topics!.map((t) => {
            const tally = tallies[t.id] ?? { affirm: 0, reject: 0, abstain: 0 };
            return (
              <li key={t.id} className="card">
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <Link href={`/topics/${t.id}`} className="font-medium hover:underline">
                      {t.title}
                    </Link>
                    {t.description && (
                      <p className="text-sm text-muted mt-1 line-clamp-2">{t.description}</p>
                    )}
                    <div className="mt-2 flex items-center gap-2 text-xs">
                      <span className="badge">{t.status}</span>
                      {t.closes_at && (
                        <span className="text-muted">
                          closes {new Date(t.closes_at).toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right text-sm">
                    <div className="text-emerald-600">Affirm {tally.affirm}</div>
                    <div className="text-rose-600">Reject {tally.reject}</div>
                    <div className="text-muted">Abstain {tally.abstain}</div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
