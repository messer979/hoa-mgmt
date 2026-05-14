import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function TopicsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireUser();

  const { q: rawQ } = await searchParams;
  const q = (rawQ ?? "").trim();

  const supabase = createAdminClient();
  let query = supabase
    .from("topics")
    .select("id,title,description,status,closes_at,created_at");
  if (q) {
    // Escape % and , for the OR filter string; underscores are wildcards in
    // LIKE/ILIKE but harmless here. The OR pattern is supabase-js syntax.
    const safe = q.replace(/[%,]/g, " ");
    query = query.or(`title.ilike.%${safe}%,description.ilike.%${safe}%`);
  }
  const { data: topicsRaw } = await query;

  const ids = (topicsRaw ?? []).map((t) => t.id);
  const tallies: Record<string, { affirm: number; reject: number; abstain: number }> = {};
  const lastActivity: Record<string, string> = {};
  if (ids.length) {
    const [{ data: votes }, { data: msgs }] = await Promise.all([
      supabase.from("votes").select("topic_id,choice").in("topic_id", ids),
      supabase
        .from("topic_messages")
        .select("topic_id,created_at,original_date")
        .in("topic_id", ids),
    ]);
    for (const v of votes ?? []) {
      const t = (tallies[v.topic_id] ??= { affirm: 0, reject: 0, abstain: 0 });
      t[v.choice as "affirm" | "reject" | "abstain"]++;
    }
    for (const m of msgs ?? []) {
      const ts = m.original_date ?? m.created_at;
      if (!ts) continue;
      const cur = lastActivity[m.topic_id];
      if (!cur || ts > cur) lastActivity[m.topic_id] = ts;
    }
  }

  const topics = (topicsRaw ?? []).slice().sort((a, b) => {
    const ta = lastActivity[a.id] ?? a.created_at;
    const tb = lastActivity[b.id] ?? b.created_at;
    return tb.localeCompare(ta);
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Topics</h1>
        <div className="flex items-center gap-2">
          <details className="relative">
            <summary
              className="cursor-pointer btn !p-2"
              aria-label="Search topics"
              title="Search topics"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            </summary>
            <form
              method="get"
              action="/topics"
              className="absolute right-0 top-full mt-1 z-10 rounded-md border border-border bg-bg shadow-lg p-2 w-72"
            >
              <input
                type="search"
                name="q"
                defaultValue={q}
                autoFocus
                placeholder="Filter by title or description…"
                className="input w-full"
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                {q ? (
                  <Link href="/topics" className="text-xs hover:underline">
                    Clear
                  </Link>
                ) : (
                  <span className="text-xs text-muted">Press Enter to search</span>
                )}
                <button className="btn !py-1 !text-xs">Search</button>
              </div>
            </form>
          </details>
          <Link href="/topics/new" className="btn-primary">New topic</Link>
        </div>
      </div>

      {q && (
        <div className="flex items-center gap-2 text-xs">
          <span className="badge">
            Filtered: <span className="ml-1 font-medium">{q}</span>
          </span>
          <Link href="/topics" className="hover:underline">Clear</Link>
          <span className="text-muted">
            {(topics ?? []).length}{" "}
            {(topics ?? []).length === 1 ? "match" : "matches"}
          </span>
        </div>
      )}

      {(topics ?? []).length === 0 ? (
        <p className="text-sm text-muted">
          {q
            ? "No topics match that filter."
            : "No topics yet. Create one to start a vote."}
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
