// Applies the SQL migrations in ./drizzle and seeds the default location
// types on a fresh database. Uses only `pg` so it can run inside the Next.js
// standalone output (the Docker image runs it before starting the server).
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { Pool } = require("pg");

const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

// The README's example hierarchy — alpha shelves, numeric boxes, roman bins.
// Only seeded while no type exists, so renaming or deleting them sticks.
const DEFAULT_LOCATION_TYPES = [
  { name: "Shelf", pattern: "{A}", icon: "shelf" },
  { name: "Box", pattern: "{N}", icon: "box" },
  { name: "Bin", pattern: "{R}", icon: "bin" },
];

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS applied_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();

    for (const file of files) {
      const { rowCount } = await client.query(
        "SELECT 1 FROM applied_migrations WHERE name = $1",
        [file],
      );
      if (rowCount > 0) continue;

      const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      const statements = sql
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter(Boolean);

      await client.query("BEGIN");
      try {
        for (const statement of statements) await client.query(statement);
        await client.query("INSERT INTO applied_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log(`Applied migration ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }

    const { rowCount: typeCount } = await client.query("SELECT 1 FROM location_types LIMIT 1");
    if (typeCount === 0) {
      for (const [position, type] of DEFAULT_LOCATION_TYPES.entries()) {
        await client.query(
          "INSERT INTO location_types (name, label_pattern, icon, position) VALUES ($1, $2, $3, $4)",
          [type.name, type.pattern, type.icon, position],
        );
      }
      console.log("Seeded default location types");
    }
    console.log("Database is up to date");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
