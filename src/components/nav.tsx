import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";

export async function Nav() {
  const me = await getCurrentProfile();
  const isAdmin = me?.role === "admin";
  const name = me?.full_name ?? me?.email ?? "";

  return (
    <header className="border-b border-border bg-surface/70 backdrop-blur">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-5">
        <Link
          href="/topics"
          className="text-lg font-semibold tracking-tight"
          style={{ fontFamily: "ui-serif, Georgia, serif" }}
        >
          HOA Board
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/topics" className="hover:text-accent transition-colors">Topics</Link>
          <Link href="/calendar" className="hover:text-accent transition-colors">Calendar</Link>
          <Link href="/documents" className="hover:text-accent transition-colors">Documents</Link>
          <Link href="/attachments" className="hover:text-accent transition-colors">Attachments</Link>
          {isAdmin && <Link href="/inbox" className="hover:text-accent transition-colors">Inbox</Link>}
          {isAdmin && <Link href="/members" className="hover:text-accent transition-colors">Members</Link>}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="text-muted">{name}{isAdmin ? " · admin" : ""}</span>
          <form action="/auth/signout" method="post">
            <button className="btn">Sign out</button>
          </form>
        </div>
      </div>
    </header>
  );
}
