import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { deleteEmail } from "./actions";

export const dynamic = "force-dynamic";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  await requireAdmin();
  const { filter = "unprocessed" } = await searchParams;

  const supabase = createAdminClient();
  let q = supabase
    .from("emails")
    .select("id,from_email,from_name,subject,received_at,processed,topic_id,matched_profile_id")
    .order("received_at", { ascending: false })
    .limit(200);
  if (filter === "unprocessed") q = q.eq("processed", false);
  const { data: emails } = await q;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Inbox</h1>
        <div className="flex items-center gap-2 text-sm">
          <Link
            href="/inbox?filter=unprocessed"
            className={"btn" + (filter === "unprocessed" ? " border-accent" : "")}
          >
            Needs review
          </Link>
          <Link
            href="/inbox?filter=all"
            className={"btn" + (filter === "all" ? " border-accent" : "")}
          >
            All
          </Link>
        </div>
      </div>

      {(emails ?? []).length === 0 ? (
        <p className="text-sm text-muted">
          No emails {filter === "unprocessed" ? "to review" : "yet"}. Forward replies to
          your Resend inbound address to see them here.
        </p>
      ) : (
        <ul className="divide-y divide-border border border-border rounded-lg overflow-hidden">
          {emails!.map((e) => (
            <li
              key={e.id}
              className="flex items-center gap-3 p-3 hover:bg-muted/10"
            >
              <Link
                href={`/inbox/${e.id}`}
                className="flex-1 min-w-0 flex items-center gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {e.subject || "(no subject)"}
                  </div>
                  <div className="text-xs text-muted truncate">
                    {e.from_name ? `${e.from_name} <${e.from_email}>` : e.from_email}
                  </div>
                </div>
                {!e.matched_profile_id && (
                  <span className="badge text-amber-700 border-amber-600">unknown sender</span>
                )}
                {e.processed ? (
                  <span className="badge text-emerald-700 border-emerald-600">processed</span>
                ) : (
                  <span className="badge">new</span>
                )}
                <span className="text-xs text-muted whitespace-nowrap">
                  {new Date(e.received_at).toLocaleString()}
                </span>
              </Link>
              <ConfirmDialog
                triggerLabel="Delete"
                triggerClassName="btn !py-1 !text-xs text-rose-600 border-rose-600"
                title={`Delete "${e.subject || "(no subject)"}"?`}
                description="The email row and any conversation message it produced are removed. Attachments and votes already recorded from it stay, just unlinked. This can't be undone."
                confirmLabel="Delete email"
                hidden={{ id: e.id }}
                action={deleteEmail}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
