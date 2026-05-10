import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import type { Attachment } from "@/lib/types";

export const dynamic = "force-dynamic";

function formatSize(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default async function AttachmentsPage() {
  await requireUser();
  const supabase = createAdminClient();

  const { data: attachments } = await supabase
    .from("attachments")
    .select("id,email_id,topic_id,storage_path,filename,content_type,size_bytes,received_at")
    .order("received_at", { ascending: false })
    .limit(500);

  const rows = (attachments ?? []) as Attachment[];
  const topicIds = Array.from(
    new Set(rows.map((a) => a.topic_id).filter((x): x is string => !!x)),
  );
  const topicTitles = new Map<string, string>();
  if (topicIds.length) {
    const { data } = await supabase
      .from("topics")
      .select("id,title")
      .in("id", topicIds);
    for (const t of data ?? []) topicTitles.set(t.id, t.title);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Attachments</h1>

      {rows.length === 0 ? (
        <p className="text-sm text-muted">
          No attachments yet. Files sent with inbound emails will appear here
          and on their topic page.
        </p>
      ) : (
        <ul className="divide-y divide-border border border-border rounded-lg overflow-hidden">
          {rows.map((a) => (
            <li key={a.id} className="flex items-center gap-3 p-3">
              <div className="flex-1 min-w-0">
                <a
                  href={`/api/attachments/${a.id}/download`}
                  className="text-sm font-medium hover:underline truncate block"
                >
                  {a.filename}
                </a>
                <div className="text-xs text-muted truncate">
                  {a.content_type ?? "unknown type"}
                  {" · "}
                  {formatSize(a.size_bytes)}
                  {" · "}
                  {new Date(a.received_at).toLocaleString()}
                </div>
              </div>
              {a.topic_id ? (
                <Link
                  href={`/topics/${a.topic_id}`}
                  className="badge hover:bg-muted/10"
                >
                  {topicTitles.get(a.topic_id) ?? "topic"}
                </Link>
              ) : (
                <span className="badge text-amber-700 border-amber-600">
                  unlinked
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
