import { requireUser } from "@/lib/auth";
import { NewTopicForm } from "./form";

export default async function NewTopicPage() {
  await requireUser();
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">New topic</h1>
      <NewTopicForm />
    </div>
  );
}
