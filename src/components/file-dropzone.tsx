"use client";

import { useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";

type Status = "pending" | "uploading" | "done" | "error";

type Row = {
  id: string;         // stable client-side id
  file: File;
  status: Status;
  error?: string;
  // Per-file metadata that renders as editable inputs when perFileMeta is on.
  title?: string;
  description?: string;
};

export type FileDropzoneProps = {
  /** URL the client POSTs each file to (multipart). Returns {id} on success. */
  endpoint: string;
  /** Optional key/value fields sent along with every file. */
  extraFields?: Record<string, string>;
  /** Input accept string, e.g. "application/pdf,image/*". */
  accept?: string;
  /** Bytes per file cap. Server enforces too. */
  maxBytes?: number;
  /** Show a title + description input per row (Documents). */
  perFileMeta?: boolean;
  /** Text shown in the drop zone. */
  hint?: string;
  /** Called after a batch finishes (all rows either done or error). */
  onBatchComplete?: () => void;
};

function fmt(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function stripExt(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

let uid = 0;
const newId = () => `f${++uid}-${Date.now()}`;

export function FileDropzone({
  endpoint,
  extraFields,
  accept,
  maxBytes = 25 * 1024 * 1024,
  perFileMeta = false,
  hint = "Drag files here, or browse",
  onBatchComplete,
}: FileDropzoneProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);

  function addFiles(list: FileList | File[]) {
    const arr = Array.from(list);
    const additions: Row[] = arr.map((file) => ({
      id: newId(),
      file,
      status: file.size > maxBytes ? "error" : "pending",
      error: file.size > maxBytes ? "Over 25 MB" : undefined,
      title: perFileMeta ? stripExt(file.name) : undefined,
      description: perFileMeta ? "" : undefined,
    }));
    setRows((cur) => [...cur, ...additions]);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  }

  function remove(id: string) {
    setRows((cur) => cur.filter((r) => r.id !== id));
  }

  function updateRow(id: string, patch: Partial<Row>) {
    setRows((cur) => cur.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  async function uploadAll() {
    const queue = rows.filter((r) => r.status === "pending");
    if (queue.length === 0) return;
    setBusy(true);

    // Sequential upload: keeps memory + server load predictable, and the
    // per-file status list gives visible progress without needing byte-level
    // upload progress plumbing.
    for (const row of queue) {
      updateRow(row.id, { status: "uploading", error: undefined });
      try {
        const fd = new FormData();
        fd.set("file", row.file);
        if (perFileMeta) {
          if (row.title) fd.set("title", row.title);
          if (row.description) fd.set("description", row.description);
        }
        if (extraFields) {
          for (const [k, v] of Object.entries(extraFields)) fd.set(k, v);
        }
        const res = await fetch(endpoint, { method: "POST", body: fd });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? `Upload failed (${res.status})`);
        }
        updateRow(row.id, { status: "done" });
      } catch (e) {
        updateRow(row.id, {
          status: "error",
          error: e instanceof Error ? e.message : "Upload failed",
        });
      }
    }

    setBusy(false);
    onBatchComplete?.();
    router.refresh();
  }

  function clearDone() {
    setRows((cur) => cur.filter((r) => r.status !== "done"));
  }

  const pending = rows.filter((r) => r.status === "pending").length;
  const done = rows.filter((r) => r.status === "done").length;
  const hasErrors = rows.some((r) => r.status === "error");

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        className={`rounded-2xl border-2 border-dashed p-8 text-center cursor-pointer transition ${
          dragOver
            ? "border-accent bg-accent/10"
            : "border-border hover:border-accent/60 hover:bg-surface"
        }`}
      >
        <div className="flex flex-col items-center gap-2">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-accent"
            aria-hidden
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <div className="text-sm font-medium">{hint}</div>
          <div className="text-xs text-muted">
            You can select multiple files · 25 MB each
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={accept}
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = ""; // allow re-picking the same file
          }}
        />
      </div>

      {rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className={`rounded-xl border p-3 flex flex-col gap-2 ${
                r.status === "error"
                  ? "border-rose-400/60 bg-rose-50/60 dark:bg-rose-950/20"
                  : r.status === "done"
                  ? "border-emerald-400/60 bg-emerald-50/60 dark:bg-emerald-950/20"
                  : "border-border bg-surface"
              }`}
            >
              <div className="flex items-center gap-3">
                <FileIcon type={r.file.type} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{r.file.name}</div>
                  <div className="text-xs text-muted">
                    {fmt(r.file.size)}
                    {r.file.type ? ` · ${r.file.type}` : ""}
                  </div>
                </div>
                <StatusBadge status={r.status} error={r.error} />
                {r.status === "pending" && (
                  <button
                    type="button"
                    onClick={() => remove(r.id)}
                    className="text-muted hover:text-fg text-lg leading-none px-1"
                    aria-label="Remove"
                  >
                    ×
                  </button>
                )}
              </div>
              {perFileMeta && r.status !== "done" && (
                <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-2 pl-9">
                  <input
                    className="input !py-1 !text-xs"
                    placeholder="Title"
                    value={r.title ?? ""}
                    disabled={r.status !== "pending"}
                    onChange={(e) => updateRow(r.id, { title: e.target.value })}
                  />
                  <input
                    className="input !py-1 !text-xs"
                    placeholder="Description (optional)"
                    value={r.description ?? ""}
                    disabled={r.status !== "pending"}
                    onChange={(e) => updateRow(r.id, { description: e.target.value })}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {rows.length > 0 && (
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-muted">
            {done > 0 && <>Uploaded {done} · </>}
            {pending > 0 ? <>{pending} pending</> : hasErrors ? "check errors above" : ""}
          </div>
          <div className="flex items-center gap-2">
            {done > 0 && !busy && (
              <button type="button" className="btn !py-1 !text-xs" onClick={clearDone}>
                Clear finished
              </button>
            )}
            <button
              type="button"
              className="btn-primary"
              disabled={busy || pending === 0}
              onClick={uploadAll}
            >
              {busy
                ? "Uploading…"
                : `Upload ${pending} file${pending === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status, error }: { status: Status; error?: string }) {
  if (status === "pending") return <span className="badge text-xs">Ready</span>;
  if (status === "uploading")
    return (
      <span className="badge text-xs inline-flex items-center gap-1">
        <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
        Uploading
      </span>
    );
  if (status === "done")
    return (
      <span className="badge text-xs text-emerald-800 border-emerald-600">
        ✓ Done
      </span>
    );
  return (
    <span
      className="badge text-xs text-rose-800 border-rose-600 max-w-[16rem] truncate"
      title={error}
    >
      ✕ {error ?? "Failed"}
    </span>
  );
}

function FileIcon({ type }: { type: string }) {
  const isImage = type.startsWith("image/");
  const isPdf = type === "application/pdf";
  const bg = isPdf
    ? "bg-rose-100 text-rose-700"
    : isImage
    ? "bg-sky-100 text-sky-700"
    : "bg-surface text-muted";
  const label = isPdf ? "PDF" : isImage ? "IMG" : "FILE";
  return (
    <div
      className={`w-6 h-6 rounded-md text-[9px] font-semibold flex items-center justify-center ${bg}`}
      aria-hidden
    >
      {label}
    </div>
  );
}
