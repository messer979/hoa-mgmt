import { requireAdmin } from "@/lib/auth";
import { createTopic } from "../actions";

export default async function NewTopicPage() {
  await requireAdmin();
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
        <label className="flex items-center gap-2">
          <input type="checkbox" name="notify" defaultChecked />
          <span>Email all members</span>
        </label>
        <button className="btn-primary">Create topic</button>
      </form>
    </div>
  );
}
