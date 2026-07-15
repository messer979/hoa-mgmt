// Next.js runs this once per server process on boot. We use it to apply
// pending SQL migrations before the app starts serving requests. Runs in
// dev and prod; the runner tracks applied files so repeat boots are cheap.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.SKIP_MIGRATIONS === "1") {
    console.log("migrate: SKIP_MIGRATIONS=1 set; skipping");
    return;
  }
  const { runMigrations } = await import("./lib/migrate");
  try {
    await runMigrations();
  } catch (e) {
    // Don't crash the server on migration failure — log loudly and let
    // the operator decide. Failing hard would leave the app unreachable
    // for a bad migration; better to boot degraded and be visible.
    console.error("migrate: startup migrations failed", e);
  }
}
