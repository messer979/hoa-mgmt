// Standalone migration runner for CI or one-off use:
//   DATABASE_URL=... npx tsx src/lib/migrate-cli.ts
import { runMigrations } from "./migrate";

runMigrations()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
