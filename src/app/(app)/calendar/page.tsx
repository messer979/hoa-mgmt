import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { Event } from "@/lib/types";
import { deleteEvent } from "./actions";

export const dynamic = "force-dynamic";

function formatWhen(starts_at: string, ends_at: string | null): string {
  const start = new Date(starts_at);
  const end = ends_at ? new Date(ends_at) : null;
  const startStr = start.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  if (!end) return startStr;
  const sameDay = start.toDateString() === end.toDateString();
  const endStr = end.toLocaleString(
    undefined,
    sameDay
      ? { hour: "numeric", minute: "2-digit" }
      : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
  );
  return `${startStr} → ${endStr}`;
}

export default async function CalendarPage() {
  const me = await requireUser();
  const isAdmin = me.role === "admin";

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("events")
    .select("id,title,description,location,starts_at,ends_at,created_by,created_at")
    .order("starts_at", { ascending: true });

  const events = (data ?? []) as Event[];
  const now = new Date().toISOString();
  const upcoming = events.filter((e) => (e.ends_at ?? e.starts_at) >= now);
  const past = events
    .filter((e) => (e.ends_at ?? e.starts_at) < now)
    .reverse();

  const renderItem = (e: Event) => (
    <li key={e.id} className="card">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-medium">{e.title}</div>
          <div className="text-xs text-muted mt-1">
            {formatWhen(e.starts_at, e.ends_at)}
            {e.location ? ` · ${e.location}` : ""}
          </div>
          {e.description && (
            <p className="text-sm text-muted mt-2 whitespace-pre-wrap">
              {e.description}
            </p>
          )}
        </div>
        {isAdmin && (
          <ConfirmDialog
            triggerLabel="Delete"
            triggerClassName="btn !py-1 !text-xs text-rose-600 border-rose-600"
            title={`Delete "${e.title}"?`}
            description="This event is removed from the calendar. This can't be undone."
            confirmLabel="Delete event"
            hidden={{ id: e.id }}
            action={deleteEvent}
          />
        )}
      </div>
    </li>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Calendar</h1>
        <Link href="/calendar/new" className="btn-primary">New event</Link>
      </div>

      <section className="space-y-3">
        <h2 className="font-medium">Upcoming</h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted">
            No upcoming events. Log one to get started.
          </p>
        ) : (
          <ul className="space-y-3">{upcoming.map(renderItem)}</ul>
        )}
      </section>

      {past.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-medium">Past</h2>
          <ul className="space-y-3">{past.map(renderItem)}</ul>
        </section>
      )}
    </div>
  );
}
