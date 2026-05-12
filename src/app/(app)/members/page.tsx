import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { addMember, resendInvite, updateMember, removeMember } from "./actions";
import type { Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function MembersPage() {
  await requireAdmin();
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("profiles")
    .select("id,email,full_name,unit_number,role,created_at")
    .order("full_name", { ascending: true });
  const members = (data ?? []) as Profile[];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Members</h1>

      <section className="card">
        <h2 className="font-medium mb-3">Add member</h2>
        <form action={addMember} className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
            <div className="md:col-span-2">
              <label className="label" htmlFor="full_name">Full name</label>
              <input id="full_name" name="full_name" className="input" required />
            </div>
            <div className="md:col-span-2">
              <label className="label" htmlFor="email">Email</label>
              <input id="email" name="email" type="email" className="input" required />
            </div>
            <div>
              <label className="label" htmlFor="unit_number">Unit</label>
              <input id="unit_number" name="unit_number" className="input" />
            </div>
            <div>
              <label className="label" htmlFor="role">Role</label>
              <select id="role" name="role" defaultValue="member" className="input">
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <button className="btn-primary md:col-span-1">Add</button>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="send_invite" defaultChecked />
            <span>
              Send invite email with a sign-in link
            </span>
          </label>
        </form>
      </section>

      <section className="card">
        <h2 className="font-medium mb-3">Roster ({members.length})</h2>
        <ul className="divide-y divide-border">
          {members.map((m) => (
            <li key={m.id} className="py-3">
              <form action={updateMember} className="grid grid-cols-1 md:grid-cols-6 gap-2 items-end">
                <input type="hidden" name="id" value={m.id} />
                <div className="md:col-span-2">
                  <label className="label">Name</label>
                  <input name="full_name" defaultValue={m.full_name ?? ""} className="input" />
                </div>
                <div className="md:col-span-2">
                  <label className="label">Email</label>
                  <input name="email" type="email" defaultValue={m.email} className="input" />
                </div>
                <div>
                  <label className="label">Unit</label>
                  <input name="unit_number" defaultValue={m.unit_number ?? ""} className="input" />
                </div>
                <div>
                  <label className="label">Role</label>
                  <select name="role" defaultValue={m.role} className="input">
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div className="md:col-span-6 flex items-center gap-2">
                  <button className="btn">Save</button>
                </div>
              </form>
              <div className="mt-2 flex items-center gap-3">
                <form action={resendInvite}>
                  <input type="hidden" name="id" value={m.id} />
                  <button className="text-xs hover:underline">Resend invite</button>
                </form>
                <form action={removeMember}>
                  <input type="hidden" name="id" value={m.id} />
                  <button className="text-xs text-rose-600 hover:underline">Remove member</button>
                </form>
              </div>
            </li>
          ))}
          {!members.length && <li className="text-sm text-muted py-3">No members yet.</li>}
        </ul>
      </section>
    </div>
  );
}
