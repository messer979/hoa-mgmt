import { redirect } from "next/navigation";
import { getCurrentProfile, issueMagicLink } from "@/lib/auth";
import { sendMagicLink } from "@/lib/email";
import { getBaseUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

async function requestLink(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) redirect("/login?status=invalid");

  // Always behave the same whether or not the email is on the roster — we
  // don't want the form to leak whether someone is a member.
  const issued = await issueMagicLink(email);
  if (issued.ok) {
    try {
      const baseUrl = await getBaseUrl();
      const link = `${baseUrl}/auth/verify?token=${encodeURIComponent(issued.token)}`;
      await sendMagicLink({
        to: issued.profile.email,
        recipientName: issued.profile.full_name,
        link,
      });
    } catch (e) {
      console.error("login: sendMagicLink failed", e);
    }
  } else {
    console.log("login: not issuing link", { email, reason: issued.reason });
  }
  redirect("/login?status=sent");
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const me = await getCurrentProfile();
  if (me) redirect("/topics");

  const { status } = await searchParams;

  return (
    <main className="min-h-screen grid place-items-center p-6">
      <div className="card w-full max-w-sm space-y-3">
        <div>
          <h1 className="text-xl font-semibold">HOA Board</h1>
          <p className="text-sm text-muted">
            Enter your email and we&apos;ll send you a sign-in link.
          </p>
        </div>
        {status === "sent" ? (
          <div className="text-sm space-y-2">
            <p>
              If your email is on the roster, a sign-in link is on its way.
              Open it on this device to finish signing in.
            </p>
            <p className="text-muted text-xs">
              Link expires in 30 minutes. Didn&apos;t arrive? Check spam, or ask
              an admin to confirm your email is on the roster.
            </p>
            <a className="btn w-full mt-2" href="/login">Send another</a>
          </div>
        ) : (
          <form action={requestLink} className="space-y-3">
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoFocus
                className="input"
              />
            </div>
            {status === "invalid" && (
              <p className="text-sm text-rose-600">Enter a valid email.</p>
            )}
            <button className="btn-primary w-full">Send sign-in link</button>
          </form>
        )}
      </div>
    </main>
  );
}
