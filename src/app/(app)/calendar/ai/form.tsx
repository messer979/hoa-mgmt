"use client";

import { useState, useTransition } from "react";
import { createEventsBulk } from "../actions";

type Proposed = {
  title: string;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  description: string | null;
};

// Convert an ISO string (possibly with timezone offset) into the
// "YYYY-MM-DDTHH:mm" shape that <input type="datetime-local"> wants —
// interpreted in the viewer's local timezone.
function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInputValue(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function AIEventForm() {
  const [text, setText] = useState("");
  const [items, setItems] = useState<Proposed[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, startCreate] = useTransition();

  async function handleParse() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/calendar/parse-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          nowIso: new Date().toISOString(),
        }),
      });
      const body = (await res.json()) as { events?: Proposed[]; error?: string };
      if (!res.ok || !body.events) {
        throw new Error(body.error ?? "Parse failed");
      }
      setItems(body.events);
      setSelected(new Set(body.events.map((_, i) => i)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  function updateItem(i: number, patch: Partial<Proposed>) {
    setItems((cur) => {
      if (!cur) return cur;
      const next = cur.slice();
      next[i] = { ...next[i], ...patch };
      return next;
    });
  }

  function toggle(i: number) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function handleCreate() {
    if (!items) return;
    const chosen = items.filter((_, i) => selected.has(i));
    if (chosen.length === 0) return;
    const fd = new FormData();
    fd.set("events", JSON.stringify(chosen));
    startCreate(async () => {
      await createEventsBulk(fd);
    });
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <label className="label" htmlFor="paste">Paste events</label>
        <textarea
          id="paste"
          className="input min-h-40 font-mono text-xs"
          placeholder={`e.g.\nJuly 20, 6pm — Board meeting at the clubhouse\nAug 3, 10am–12pm — Community workday\n8/17 7pm — Ice cream social`}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted">
            The assistant uses your browser's timezone
            (<code>{typeof Intl !== "undefined"
              ? Intl.DateTimeFormat().resolvedOptions().timeZone
              : "UTC"}</code>).
          </p>
          <button
            type="button"
            className="btn-primary"
            disabled={loading || !text.trim()}
            onClick={handleParse}
          >
            {loading ? "Parsing…" : "Parse with AI"}
          </button>
        </div>
        {error && (
          <p className="text-xs text-rose-700">{error}</p>
        )}
      </div>

      {items !== null && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-medium">
              {items.length === 0
                ? "No events found"
                : `Review ${selected.size} of ${items.length}`}
            </h2>
            {items.length > 0 && (
              <button
                type="button"
                className="btn-primary"
                disabled={creating || selected.size === 0}
                onClick={handleCreate}
              >
                {creating
                  ? "Creating…"
                  : `Create ${selected.size} event${selected.size === 1 ? "" : "s"}`}
              </button>
            )}
          </div>

          {items.length === 0 ? (
            <p className="text-sm text-muted">
              The assistant couldn't identify any events in the pasted text.
              Try adding more explicit dates and times.
            </p>
          ) : (
            <ul className="space-y-3">
              {items.map((it, i) => {
                const checked = selected.has(i);
                return (
                  <li
                    key={i}
                    className={`rounded-xl border p-3 space-y-2 ${
                      checked ? "border-accent/40" : "border-border opacity-60"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(i)}
                        aria-label="Include this event"
                      />
                      <input
                        className="input flex-1"
                        value={it.title}
                        onChange={(e) => updateItem(i, { title: e.target.value })}
                        placeholder="Title"
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <div>
                        <label className="label text-xs">Starts</label>
                        <input
                          type="datetime-local"
                          className="input"
                          value={toLocalInputValue(it.starts_at)}
                          onChange={(e) =>
                            updateItem(i, {
                              starts_at: fromLocalInputValue(e.target.value) ?? it.starts_at,
                            })
                          }
                        />
                      </div>
                      <div>
                        <label className="label text-xs">Ends (optional)</label>
                        <input
                          type="datetime-local"
                          className="input"
                          value={toLocalInputValue(it.ends_at)}
                          onChange={(e) =>
                            updateItem(i, {
                              ends_at: fromLocalInputValue(e.target.value),
                            })
                          }
                        />
                      </div>
                    </div>
                    <input
                      className="input"
                      value={it.location ?? ""}
                      onChange={(e) =>
                        updateItem(i, { location: e.target.value || null })
                      }
                      placeholder="Location (optional)"
                    />
                    <textarea
                      className="input min-h-16"
                      value={it.description ?? ""}
                      onChange={(e) =>
                        updateItem(i, { description: e.target.value || null })
                      }
                      placeholder="Description (optional)"
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
