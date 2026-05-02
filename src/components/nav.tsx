import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export async function Nav() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  let role: "admin" | "member" = "member";
  let name = user?.email ?? "";
  if (user) {
    const { data } = await supabase
      .from("profiles")
      .select("role,full_name,email")
      .eq("id", user.id)
      .maybeSingle();
    if (data) {
      role = (data.role as "admin" | "member") ?? "member";
      name = data.full_name ?? data.email ?? name;
    }
  }
  const isAdmin = role === "admin";

  return (
    <header className="border-b border-border">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-4">
        <Link href="/topics" className="font-semibold">HOA Board</Link>
        <nav className="flex items-center gap-3 text-sm">
          <Link href="/topics" className="hover:underline">Topics</Link>
          {isAdmin && <Link href="/inbox" className="hover:underline">Inbox</Link>}
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
