// Startup migration runner. Reads supabase/migrations/*.sql in filename
// order, tracks applied files in public._migrations, and runs pending ones
// each inside its own transaction. Safe to run on every boot: applied
// migrations are skipped by the tracker.
//
// Requires a direct Postgres connection string (supabase-js can't do DDL).
// We look at DATABASE_URL, then SUPABASE_DB_URL, then POSTGRES_URL. If
// none is set the runner logs and returns — the app still boots and the
// existing schema keeps working.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

function connectionString(): string | null {
  return (
    process.env.DATABASE_URL ??
    process.env.SUPABASE_DB_URL ??
    process.env.POSTGRES_URL ??
    null
  );
}

// Coalesce concurrent invocations (e.g. multiple worker threads calling
// register()) so the migration set only runs once per process lifetime.
let runOnce: Promise<void> | null = null;

export function runMigrations(): Promise<void> {
  if (!runOnce) runOnce = runMigrationsInner();
  return runOnce;
}

async function runMigrationsInner(): Promise<void> {
  const url = connectionString();
  if (!url) {
    console.warn(
      "migrate: DATABASE_URL / SUPABASE_DB_URL / POSTGRES_URL is not set; skipping auto-migrate",
    );
    return;
  }

  // Supabase requires TLS; rejectUnauthorized:false matches how most
  // Node clients connect to hosted Postgres without pinning a CA bundle.
  const client = new Client({
    connectionString: url,
    ssl: url.includes("sslmode=disable")
      ? undefined
      : { rejectUnauthorized: false },
  });

  const start = Date.now();
  await client.connect();
  try {
    await client.query(`
      create table if not exists public._migrations (
        filename   text primary key,
        applied_at timestamptz not null default now()
      );
    `);

    const { rows } = await client.query<{ filename: string }>(
      "select filename from public._migrations",
    );
    const applied = new Set(rows.map((r) => r.filename));

    let files: string[];
    try {
      files = (await readdir(MIGRATIONS_DIR))
        .filter((f) => f.endsWith(".sql"))
        .sort();
    } catch (e) {
      console.warn("migrate: migrations dir not readable, skipping", e);
      return;
    }

    const pending = files.filter((f) => !applied.has(f));
    if (pending.length === 0) {
      console.log(`migrate: up to date (${files.length} applied, ${Date.now() - start}ms)`);
      return;
    }

    console.log(`migrate: applying ${pending.length} new migration(s)`);
    for (const file of pending) {
      const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
      const fileStart = Date.now();
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query(
          "insert into public._migrations (filename) values ($1)",
          [file],
        );
        await client.query("commit");
        console.log(`migrate: applied ${file} (${Date.now() - fileStart}ms)`);
      } catch (e) {
        await client.query("rollback").catch(() => {});
        console.error(`migrate: FAILED on ${file}`, e);
        throw e;
      }
    }
    console.log(`migrate: done in ${Date.now() - start}ms`);
  } finally {
    await client.end().catch(() => {});
  }
}
