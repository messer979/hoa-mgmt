"use client";

import {
  useRef,
  useState,
  useTransition,
  type DragEvent,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { RichEditor } from "@/components/rich-editor";
import { announceTopic, createTopic } from "../actions";

type QueuedFile = {
  id: string;
  file: File;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
};

function fmt(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

let uid = 0;
const newId = () => `f${++uid}-${Date.now()}`;

export function NewTopicForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [notify, setNotify] = useState(true);
  const [files, setFiles] = useState<QueuedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<null | "creating" | "uploading" | "announcing">(null);
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function addFiles(list: FileList | File[]) {
    const arr = Array.from(list);
    const additions: QueuedFile[] = arr.map((file) => ({
      id: newId(),
      file,
      status: "pending",
    }));
    setFiles((cur) => [...cur, ...additions]);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  }

  function removeFile(id: string) {
    setFiles((cur) => cur.filter((f) => f.id !== id));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError("Title is required");
      return;
    }

    const fd = new FormData();
    fd.set("title", title.trim());
    fd.set("description", description);
    if (closesAt) fd.set("closes_at", closesAt);

    setPhase("creating");
    let topicId: string;
    try {
      const res = await createTopic(fd);
      topicId = res.id;
    } catch (err) {
      setPhase(null);
      setError(err instanceof Error ? err.message : "Failed to create topic");
      return;
    }

    // Upload sequentially so failures are easy to attribute per file.
    if (files.length) {
      setPhase("uploading");
      for (const f of files) {
        setFiles((cur) =>
          cur.map((x) => (x.id === f.id ? { ...x, status: "uploading" } : x)),
        );
        const upload = new FormData();
        upload.set("file", f.file);
        upload.set("topic_id", topicId);
        try {
          const res = await fetch("/api/attachments/upload", {
            method: "POST",
            body: upload,
          });
          if (!res.ok) {
            const body = await res.json().catch(() => null);
            throw new Error(body?.error ?? `Upload failed (${res.status})`);
          }
          setFiles((cur) =>
            cur.map((x) => (x.id === f.id ? { ...x, status: "done" } : x)),
          );
        } catch (err) {
          setFiles((cur) =>
            cur.map((x) =>
              x.id === f.id
                ? { ...x, status: "error", error: err instanceof Error ? err.message : "failed" }
                : x,
            ),
          );
        }
      }
    }

    if (notify) {
      setPhase("announcing");
      const announceFd = new FormData();
      announceFd.set("topic_id", topicId);
      try {
        await announceTopic(announceFd);
      } catch (err) {
        console.error("announce failed", err);
        // Non-fatal: topic is created + files uploaded, just log.
      }
    }

    setPhase(null);
    startTransition(() => {
      router.push(`/topics/${topicId}`);
      router.refresh();
    });
  }

  const busy = phase !== null;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="card space-y-3">
        <div>
          <label className="label" htmlFor="title">Title</label>
          <input
            id="title"
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            disabled={busy}
          />
        </div>

        <div>
          <label className="label">Description</label>
          <RichEditor
            value={description}
            onChange={setDescription}
            placeholder="What's this vote or discussion about? Add links, lists, styling…"
          />
        </div>

        <div>
          <label className="label" htmlFor="closes_at">Closes at (optional)</label>
          <input
            id="closes_at"
            type="datetime-local"
            className="input"
            value={closesAt}
            onChange={(e) => setClosesAt(e.target.value)}
            disabled={busy}
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={notify}
            onChange={(e) => setNotify(e.target.checked)}
            disabled={busy}
          />
          <span>Email all members when created</span>
        </label>
      </div>

      <div className="card space-y-3">
        <div className="text-sm font-medium">Attachments (optional)</div>
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
          className={`rounded-2xl border-2 border-dashed p-6 text-center cursor-pointer transition ${
            dragOver
              ? "border-accent bg-accent/10"
              : "border-border hover:border-accent/60 hover:bg-surface"
          }`}
        >
          <div className="text-sm">Drag files or click to browse</div>
          <div className="text-xs text-muted mt-1">
            Attach reference docs to send with the topic · 25 MB each
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {files.length > 0 && (
          <ul className="space-y-1.5">
            {files.map((f) => (
              <li
                key={f.id}
                className={`flex items-center gap-3 p-2 rounded-lg border text-sm ${
                  f.status === "error"
                    ? "border-rose-400/60 bg-rose-50/60 dark:bg-rose-950/20"
                    : f.status === "done"
                    ? "border-emerald-400/60 bg-emerald-50/60 dark:bg-emerald-950/20"
                    : "border-border bg-surface"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="truncate">{f.file.name}</div>
                  <div className="text-xs text-muted">{fmt(f.file.size)}</div>
                </div>
                <StatusLabel f={f} />
                {f.status === "pending" && !busy && (
                  <button
                    type="button"
                    onClick={() => removeFile(f.id)}
                    className="text-muted hover:text-fg text-lg leading-none px-1"
                    aria-label="Remove"
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p className="text-sm text-rose-700">{error}</p>}

      <div className="flex items-center gap-3">
        <button type="submit" className="btn-primary" disabled={busy}>
          {phase === "creating"
            ? "Creating…"
            : phase === "uploading"
            ? "Uploading files…"
            : phase === "announcing"
            ? "Sending announcement…"
            : "Create topic"}
        </button>
        {busy && (
          <span className="text-xs text-muted">
            Don't close this tab until it's finished.
          </span>
        )}
      </div>
    </form>
  );
}

function StatusLabel({ f }: { f: QueuedFile }) {
  if (f.status === "pending") return <span className="badge text-xs">Ready</span>;
  if (f.status === "uploading")
    return (
      <span className="badge text-xs inline-flex items-center gap-1">
        <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
        Uploading
      </span>
    );
  if (f.status === "done")
    return (
      <span className="badge text-xs text-emerald-800 border-emerald-600">
        ✓ Done
      </span>
    );
  return (
    <span
      className="badge text-xs text-rose-800 border-rose-600 max-w-[14rem] truncate"
      title={f.error}
    >
      ✕ {f.error ?? "Failed"}
    </span>
  );
}
