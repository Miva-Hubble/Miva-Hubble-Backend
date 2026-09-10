// Run with: npx dotenv -e .env.production -- npx tsx backup-user-table.ts
// (copy into the repo root first)
//
// Free-tier Supabase has no on-demand snapshot / PITR, and pg_dump isn't
// installed on this machine. This is a manual substitute: dump every row
// of the one table this migration touches (User) to a timestamped JSON
// file, so we have something concrete to restore from if the migration
// goes wrong.
import "dotenv/config";
import { Client } from "pg";
import { writeFileSync } from "fs";

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
console.log("Connecting with URL host:", url?.split("@")[1]);

const client = new Client({ connectionString: url });

async function main() {
  await client.connect();

  const dbInfo = await client.query("SELECT current_database()");
  console.log("Connected to:", dbInfo.rows[0]);

  const result = await client.query('SELECT * FROM "User"');
  console.log(`Fetched ${result.rows.length} User rows.`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `user_table_backup_${timestamp}.json`;
  writeFileSync(filename, JSON.stringify(result.rows, null, 2));

  console.log(`Backup written to ${filename}`);
  console.log(
    `Row count: ${result.rows.length} — verify this matches what you expect before proceeding.`,
  );

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
