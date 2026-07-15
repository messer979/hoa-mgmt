import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SubmitButton } from "@/components/submit-button";
import { canViewInline } from "@/lib/attachments";
import type { Document, Profile } from "@/lib/types";
import { deleteDocument, uploadDocument } from "./actions";

export const dynamic = "force-dynamic";

function formatSize(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default async function DocumentsPage() {
  const me = await requireUser();
  const supabase = createAdminClient();

  const { data: rows } = await supabase
    .from("documents")
    .select(
      "id,title,description,storage_path,filename,content_type,size_bytes,uploaded_by,created_at",
    )
    .order("created_at", { ascending: false })
    .limit(500);
  const docs = (rows ?? []) as Document[];

  const uploaderIds = Array.from(
    new Set(docs.map((d) => d.uploaded_by).filter((v): v is string => !!v)),
  );
  const profilesById = new Map<string, Profile>();
  if (uploaderIds.length) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("*")
      .in("id", uploaderIds);
    for (const p of (profs ?? []) as Profile[]) profilesById.set(p.id, p);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Documents</h1>
      <p className="text-sm text-muted">
        HOA-wide library: bylaws, covenants, meeting minutes, and anything
        else worth keeping on hand. Anyone can upload.
      </p>

      <section className="card">
        <h2 className="font-medium mb-3">Upload a document</h2>
        <form
          action={uploadDocument}
          encType="multipart/form-data"
          className="space-y-3"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="title">Title (optional)</label>
              <input id="title" name="title" className="input" placeholder="e.g. Bylaws (2024 revision)" />
            </div>
            <div>
              <label className="label" htmlFor="file">File</label>
              <input
                id="file"
                type="file"
                name="file"
                required
                className="text-sm w-full file:btn file:mr-3"
              />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="description">Description (optional)</label>
            <textarea
              id="description"
              name="description"
              className="input min-h-20"
              placeholder="Short note about what this document covers…"
            />
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted">25 MB max per file.</p>
            <SubmitButton pendingLabel="Uploading…">Upload</SubmitButton>
          </div>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">All documents</h2>
        {docs.length === 0 ? (
          <p className="text-sm text-muted">
            No documents yet. Upload the first one to get started.
          </p>
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {docs.map((d) => {
              const uploader = d.uploaded_by ? profilesById.get(d.uploaded_by) : null;
              const canDelete = me.role === "admin" || d.uploaded_by === me.id;
              return (
                <li key={d.id} className="card space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">
                        {d.title ?? d.filename}
                      </div>
                      <div className="text-xs text-muted truncate">
                        {d.filename} · {d.content_type ?? "unknown"} · {formatSize(d.size_bytes)}
                      </div>
                    </div>
                  </div>
                  {d.description && (
                    <p className="text-sm text-muted whitespace-pre-wrap">
                      {d.description}
                    </p>
                  )}
                  <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-border">
                    <a
                      href={`/api/documents/${d.id}/download`}
                      className="btn !py-1 !text-xs"
                    >
                      Download
                    </a>
                    {canViewInline(d.content_type) && (
                      <a
                        href={`/api/documents/${d.id}/view`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn !py-1 !text-xs"
                      >
                        View
                      </a>
                    )}
                    <span className="ml-auto text-xs text-muted">
                      {uploader?.full_name ?? uploader?.email ?? "member"}
                      {" · "}
                      {new Date(d.created_at).toLocaleDateString()}
                    </span>
                    {canDelete && (
                      <ConfirmDialog
                        triggerLabel="Delete"
                        triggerClassName="btn !py-1 !text-xs text-rose-600 border-rose-600"
                        title={`Delete "${d.title ?? d.filename}"?`}
                        description="The file is removed from storage. This can't be undone."
                        confirmLabel="Delete"
                        hidden={{ id: d.id }}
                        action={deleteDocument}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
