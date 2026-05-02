import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createTopic } from "../actions";

export default async function NewTopicPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user!.id)
    .maybeSingle();
  if (me?.role !== "admin") redirect("/topics");

  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-xl font-semibold">New topic</h1>
      <form action={createTopic} className="space-y-3 card">
        <div>
          <label className="label" htmlFor="title">Title</label>
          <input id="title" name="title" className="input" required />
        </div>
        <div>
          <label className="label" htmlFor="description">Description</label>
          <textarea id="description" name="description" className="input min-h-32" />
        </div>
        <div>
          <label className="label" htmlFor="closes_at">Closes at (optional)</label>
          <input id="closes_at" name="closes_at" className="input" type="datetime-local" />
        </div>
        <button className="btn-primary">Create topic</button>
      </form>
    </div>
  );
}
