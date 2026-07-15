import { requireUser } from "@/lib/auth";
import { AIEventForm } from "./form";

export const dynamic = "force-dynamic";

export default async function CalendarAIPage() {
  await requireUser();
  const aiConfigured = !!process.env.OPENROUTER_API_KEY;

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">AI event import</h1>
        <p className="text-sm text-muted mt-1">
          Paste a list of dates, times, and event names — meetings, socials,
          workdays. The assistant parses them, you review, then create them
          all in one shot.
        </p>
      </div>
      {aiConfigured ? (
        <AIEventForm />
      ) : (
        <div className="card text-sm">
          AI is not configured. Set <code>OPENROUTER_API_KEY</code> in the
          environment to enable this page.
        </div>
      )}
    </div>
  );
}
