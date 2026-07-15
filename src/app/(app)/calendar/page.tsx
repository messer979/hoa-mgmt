import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  addMonths,
  buildMonthGrid,
  dayKey,
  monthKey,
  monthLabel,
  parseMonthKey,
} from "@/lib/calendar";
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

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function MonthGrid({
  monthStart,
  eventsByDay,
}: {
  monthStart: Date;
  eventsByDay: Map<string, Event[]>;
}) {
  const grid = buildMonthGrid(monthStart);
  const currentMonth = monthStart.getMonth();
  const today = dayKey(new Date());

  return (
    <div className="flex-1 min-w-0">
      <div className="text-center font-medium mb-2">
        {monthLabel(monthStart)}
      </div>
      <div className="grid grid-cols-7 text-[10px] uppercase tracking-wider text-muted mb-1">
        {DOW.map((d) => (
          <div key={d} className="text-center py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden border border-border">
        {grid.flat().map((d, i) => {
          const inMonth = d.getMonth() === currentMonth;
          const key = dayKey(d);
          const dayEvents = eventsByDay.get(key) ?? [];
          const isToday = key === today;
          return (
            <div
              key={i}
              className={`min-h-20 p-1.5 text-xs flex flex-col gap-1 ${
                inMonth ? "bg-surface" : "bg-bg/60 text-muted"
              }`}
            >
              <div
                className={`text-right ${
                  isToday
                    ? "inline-flex self-end w-5 h-5 items-center justify-center rounded-full bg-accent text-[10px]"
                    : ""
                }`}
                style={isToday ? { color: "rgb(var(--accent-fg))" } : undefined}
              >
                {d.getDate()}
              </div>
              <div className="flex flex-col gap-0.5 min-w-0">
                {dayEvents.slice(0, 3).map((e) => (
                  <a
                    key={e.id}
                    href={`#event-${e.id}`}
                    className="truncate px-1 rounded text-[10px] leading-tight hover:underline"
                    style={{
                      background: "rgb(var(--accent) / 0.15)",
                      color: "rgb(var(--accent))",
                    }}
                    title={e.title}
                  >
                    {new Date(e.starts_at).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                    {" "}
                    {e.title}
                  </a>
                ))}
                {dayEvents.length > 3 && (
                  <div className="text-[10px] text-muted px-1">
                    +{dayEvents.length - 3} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const me = await requireUser();
  const isAdmin = me.role === "admin";
  const { m } = await searchParams;

  const firstMonth = parseMonthKey(m);
  const secondMonth = addMonths(firstMonth, 1);
  const prevKey = monthKey(addMonths(firstMonth, -1));
  const nextKey = monthKey(addMonths(firstMonth, 1));
  const todayKey = monthKey(new Date());

  // Query events spanning the two-month window plus a small buffer for
  // events that started before but end within it.
  const windowStart = new Date(firstMonth);
  const windowEnd = addMonths(firstMonth, 2);

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("events")
    .select("id,title,description,location,starts_at,ends_at,created_by,created_at")
    .gte("starts_at", windowStart.toISOString())
    .lt("starts_at", windowEnd.toISOString())
    .order("starts_at", { ascending: true });

  const windowEvents = (data ?? []) as Event[];
  const eventsByDay = new Map<string, Event[]>();
  for (const e of windowEvents) {
    const k = dayKey(new Date(e.starts_at));
    const arr = eventsByDay.get(k) ?? [];
    arr.push(e);
    eventsByDay.set(k, arr);
  }

  // Also fetch the full upcoming + past list for the summary below.
  const { data: allData } = await supabase
    .from("events")
    .select("id,title,description,location,starts_at,ends_at,created_by,created_at")
    .order("starts_at", { ascending: true });
  const all = (allData ?? []) as Event[];
  const nowIso = new Date().toISOString();
  const upcoming = all.filter((e) => (e.ends_at ?? e.starts_at) >= nowIso);

  const renderItem = (e: Event) => (
    <li key={e.id} id={`event-${e.id}`} className="card scroll-mt-20">
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
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-xl font-semibold">Calendar</h1>
        <div className="flex items-center gap-2">
          <Link href="/calendar/ai" className="btn">AI import</Link>
          <Link href="/calendar/new" className="btn-primary">New event</Link>
        </div>
      </div>

      <section className="card space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Link
            href={`/calendar?m=${prevKey}`}
            className="btn !py-1 !text-xs"
            aria-label="Previous month"
          >
            ← Prev
          </Link>
          <Link
            href={`/calendar?m=${todayKey}`}
            className="text-xs hover:underline text-muted"
          >
            Today
          </Link>
          <Link
            href={`/calendar?m=${nextKey}`}
            className="btn !py-1 !text-xs"
            aria-label="Next month"
          >
            Next →
          </Link>
        </div>
        <div className="flex flex-col md:flex-row gap-4">
          <MonthGrid monthStart={firstMonth} eventsByDay={eventsByDay} />
          <MonthGrid monthStart={secondMonth} eventsByDay={eventsByDay} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Upcoming</h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted">
            No upcoming events. Log one or use AI import to add a batch.
          </p>
        ) : (
          <ul className="space-y-3">{upcoming.map(renderItem)}</ul>
        )}
      </section>
    </div>
  );
}
