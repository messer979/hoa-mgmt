import { redirect } from "next/navigation";
import { isAuthed, setUserCookie } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

async function pickSelf(formData: FormData) {
  "use server";
  if (!(await isAuthed())) redirect("/login");
  const id = String(formData.get("profile_id") ?? "");
  if (!id) redirect("/whoami");
  await setUserCookie(id);
  redirect("/topics");
}

async function bootstrapFirstAdmin(formData: FormData) {
  "use server";
  if (!(await isAuthed())) redirect("/login");
  const supabase = createAdminClient();
  const { count } = await supabase
    .from("profiles")
    .select("*", { count: "exact", head: true });
  if ((count ?? 0) > 0) redirect("/whoami");

  const full_name = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!full_name || !email) redirect("/whoami");

  const { data, error } = await supabase
    .from("profiles")
    .insert({ full_name, email, role: "admin" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  await setUserCookie(data!.id);
  redirect("/members");
}

export default async function WhoAmIPage() {
  if (!(await isAuthed())) redirect("/login");

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("profiles")
    .select("id,email,full_name,unit_number,role,created_at")
    .order("full_name", { ascending: true });
  const profiles = (data ?? []) as Profile[];

  if (profiles.length === 0) {
    return (
      <main className="min-h-screen grid place-items-center p-6">
        <form action={bootstrapFirstAdmin} className="card w-full max-w-sm space-y-3">
          <div>
            <h1 className="text-xl font-semibold">First-time setup</h1>
            <p className="text-sm text-muted">
              No members yet. Add yourself as the first admin.
            </p>
          </div>
          <div>
            <label className="label" htmlFor="full_name">Full name</label>
            <input id="full_name" name="full_name" required className="input" />
          </div>
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" name="email" type="email" required className="input" />
          </div>
          <button className="btn-primary w-full">Create admin & continue</button>
        </form>
      </main>
    );
  }

  return (
    <main className="min-h-screen grid place-items-center p-6">
      <div className="card w-full max-w-sm space-y-3">
        <div>
          <h1 className="text-xl font-semibold">Who are you?</h1>
          <p className="text-sm text-muted">Pick your name to continue.</p>
        </div>
        <form action={pickSelf} className="space-y-3">
          <div>
            <label className="label" htmlFor="profile_id">Member</label>
            <select id="profile_id" name="profile_id" required className="input" defaultValue="">
              <option value="" disabled>— Select your name —</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {(p.full_name ?? p.email)} · {p.email}
                  {p.role === "admin" ? " (admin)" : ""}
                </option>
              ))}
            </select>
          </div>
          <button className="btn-primary w-full">Continue</button>
        </form>
        <form action="/auth/signout" method="post">
          <button className="btn w-full" type="submit">Sign out</button>
        </form>
      </div>
    </main>
  );
}
