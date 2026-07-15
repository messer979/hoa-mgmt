import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { canViewInline } from "@/lib/attachments";
import type { Attachment } from "@/lib/types";
import {
  assignAttachmentToTopic,
  deleteAttachment,
} from "./actions";
import { AttachmentUploadForm } from "./upload-form";

export const dynamic = "force-dynamic";

function formatSize(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default async function AttachmentsPage() {
  const me = await requireUser();
  const isAdmin = me.role === "admin";
  const supabase = createAdminClient();

  const [{ data: attachments }, { data: topics }] = await Promise.all([
    supabase
      .from("attachments")
      .select(
        "id,email_id,topic_id,storage_path,filename,content_type,size_bytes,received_at",
      )
      .order("received_at", { ascending: false })
      .limit(500),
    supabase
      .from("topics")
      .select("id,title,status")
      .order("created_at", { ascending: false }),
  ]);

  const rows = (attachments ?? []) as Attachment[];
  const allTopics = topics ?? [];
  const topicTitles = new Map(allTopics.map((t) => [t.id, t.title]));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Attachments</h1>

      <section className="card">
        <h2 className="font-medium mb-3">Upload to a topic</h2>
        {allTopics.length === 0 ? (
          <p className="text-sm text-muted">
            No topics yet — create one first.
          </p>
        ) : (
          <AttachmentUploadForm topics={allTopics} />
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">All attachments</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">
            No attachments yet. Inbound email attachments and manual uploads
            will appear here and on their topic page.
          </p>
        ) : (
          <ul className="divide-y divide-border border border-border rounded-lg overflow-hidden">
            {rows.map((a) => (
              <li
                key={a.id}
                className="p-3 flex items-center gap-3 flex-wrap"
              >
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

                {canViewInline(a.content_type) && (
                  <a
                    href={`/api/attachments/${a.id}/view`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn !py-1 !text-xs"
                  >
                    View
                  </a>
                )}

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

                {isAdmin && allTopics.length > 0 && (
                  <form
                    action={assignAttachmentToTopic}
                    className="flex items-center gap-1"
                  >
                    <input type="hidden" name="id" value={a.id} />
                    <select
                      name="topic_id"
                      defaultValue={a.topic_id ?? ""}
                      className="input !py-1 !text-xs max-w-[10rem]"
                    >
                      <option value="">— Unlinked —</option>
                      {allTopics.map((t) => (
                        <option key={t.id} value={t.id}>{t.title}</option>
                      ))}
                    </select>
                    <button className="btn !py-1 !text-xs">Assign</button>
                  </form>
                )}

                {isAdmin && (
                  <ConfirmDialog
                    triggerLabel="Delete"
                    triggerClassName="btn !py-1 !text-xs text-rose-600 border-rose-600"
                    title={`Delete "${a.filename}"?`}
                    description="The file is removed from storage and the row from the database. This can't be undone."
                    confirmLabel="Delete file"
                    hidden={{ id: a.id }}
                    action={deleteAttachment}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
