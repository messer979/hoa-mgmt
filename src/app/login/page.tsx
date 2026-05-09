import { redirect } from "next/navigation";
import { checkPassword, isAuthed, setAuthCookie } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function signIn(formData: FormData) {
  "use server";
  const password = String(formData.get("password") ?? "");
  if (!checkPassword(password)) {
    redirect("/login?error=1");
  }
  await setAuthCookie();
  redirect("/whoami");
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  if (await isAuthed()) redirect("/whoami");

  return (
    <main className="min-h-screen grid place-items-center p-6">
      <form action={signIn} className="card w-full max-w-sm space-y-3">
        <div>
          <h1 className="text-xl font-semibold">HOA Board</h1>
          <p className="text-sm text-muted">Enter the shared board password.</p>
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoFocus
            required
            className="input"
          />
        </div>
        {error && (
          <p className="text-sm text-rose-600">Incorrect password.</p>
        )}
        <button className="btn-primary w-full">Continue</button>
      </form>
    </main>
  );
}
