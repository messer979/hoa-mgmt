import { requireUser } from "@/lib/auth";
import { createEvent } from "../actions";

export default async function NewEventPage() {
  await requireUser();
  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-xl font-semibold">New event</h1>
      <form action={createEvent} className="space-y-3 card">
        <div>
          <label className="label" htmlFor="title">Title</label>
          <input id="title" name="title" className="input" required />
        </div>
        <div>
          <label className="label" htmlFor="starts_at">Starts at</label>
          <input
            id="starts_at"
            name="starts_at"
            className="input"
            type="datetime-local"
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="ends_at">Ends at (optional)</label>
          <input
            id="ends_at"
            name="ends_at"
            className="input"
            type="datetime-local"
          />
        </div>
        <div>
          <label className="label" htmlFor="location">Location (optional)</label>
          <input id="location" name="location" className="input" />
        </div>
        <div>
          <label className="label" htmlFor="description">Description (optional)</label>
          <textarea id="description" name="description" className="input min-h-32" />
        </div>
        <button className="btn-primary">Create event</button>
      </form>
    </div>
  );
}
