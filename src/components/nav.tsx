import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";

export async function Nav() {
  const me = await getCurrentProfile();
  const isAdmin = me?.role === "admin";
  const name = me?.full_name ?? me?.email ?? "";

  return (
    <header className="border-b border-border">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-4">
        <Link href="/topics" className="font-semibold">HOA Board</Link>
        <nav className="flex items-center gap-3 text-sm">
          <Link href="/topics" className="hover:underline">Topics</Link>
          {isAdmin && <Link href="/inbox" className="hover:underline">Inbox</Link>}
          {isAdmin && <Link href="/members" className="hover:underline">Members</Link>}
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
