import Link from "next/link";

export const dynamic = "force-dynamic";

const REASONS: Record<string, string> = {
  missing: "No token was provided.",
  invalid: "That sign-in link wasn't recognized. It may have been malformed or already revoked.",
  expired: "That sign-in link has expired. Request a new one.",
  already_used: "That sign-in link was already used. Request a new one.",
  db_error: "Something went wrong on our end. Try again in a moment.",
};

export default async function AuthError({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason = "invalid" } = await searchParams;
  const message = REASONS[reason] ?? REASONS.invalid;

  return (
    <main className="min-h-screen grid place-items-center p-6">
      <div className="card w-full max-w-sm space-y-3">
        <h1 className="text-xl font-semibold">Sign-in failed</h1>
        <p className="text-sm text-muted">{message}</p>
        <Link href="/login" className="btn-primary block text-center">
          Get a new sign-in link
        </Link>
      </div>
    </main>
  );
}
