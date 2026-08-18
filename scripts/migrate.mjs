#!/usr/bin/env node
/**
 * Deploy-time database migrator (node-postgres, `pg`).
 *
 * Runs during `npm run build` — on every Vercel deploy — applying pending files
 * in ../migrations to DATABASE_URL. Normal files apply transactionally;
 * `-- migrate:no-transaction` files contain individually idempotent statements
 * for operations such as CREATE INDEX CONCURRENTLY.
 *
 * No DATABASE_URL (local / preview builds) -> skip; the PGLite fallback applies
 * the same files at startup instead (see src/lib/db.ts).
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { withMigrationLock } from "./migration-lock.mjs";
import { splitPostgresStatements } from "./migration-sql.mjs";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  const deployment =
    process.env.VERCEL === "1" ||
    process.env.NETLIFY === "true" ||
    process.env.REQUIRE_DATABASE === "1" ||
    process.env.REQUIRE_DATABASE?.toLowerCase() === "true";
  const localBuild =
    ["build", "db:migrate"].includes(process.env.npm_lifecycle_event ?? "") &&
    !deployment;
  const production = process.env.NODE_ENV === "production";

  if (deployment || (production && !localBuild)) {
    console.error(
      "[migrate] DATABASE_URL is verplicht voor een productie-deployment.",
    );
    process.exit(1);
  }
  console.log(
    "[migrate] lokale dev/test zonder DATABASE_URL; PGLite migreert bij start.",
  );
  process.exit(0);
}

const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations",
);

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    await withMigrationLock(client, async () => {
      await client.query(
        "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
      );
      const applied = new Set(
        (await client.query("SELECT name FROM _migrations")).rows.map(
          (r) => r.name,
        ),
      );

      let files;
      try {
        files = (await readdir(migrationsDir))
          .filter((f) => f.endsWith(".sql"))
          .sort();
      } catch {
        console.log("[migrate] no migrations/ directory — nothing to do.");
        return;
      }

      let count = 0;
      for (const name of files) {
        if (applied.has(name)) continue;
        const text = await readFile(join(migrationsDir, name), "utf8");
        const withoutTransaction = /^\s*-- migrate:no-transaction\b/im.test(
          text,
        );
        const sqlText = text.replace(/^\s*-- migrate:no-transaction\s*/im, "");
        try {
          if (withoutTransaction) {
            // Required for operations such as CREATE INDEX CONCURRENTLY. These
            // files must be idempotent because applying + tracking cannot be one
            // transaction.
            const statements = splitPostgresStatements(sqlText);
            for (const statement of statements) {
              await client.query(statement);
            }
            await client.query("INSERT INTO _migrations (name) VALUES ($1)", [
              name,
            ]);
          } else {
            await client.query("BEGIN");
            // pg's simple-query protocol runs a whole multi-statement file at once.
            await client.query(sqlText);
            await client.query("INSERT INTO _migrations (name) VALUES ($1)", [
              name,
            ]);
            await client.query("COMMIT");
          }
        } catch (err) {
          console.error(`[migrate] error applying ${name}`);
          if (!withoutTransaction) {
            try {
              await client.query("ROLLBACK");
            } catch {
              // ROLLBACK fails when the connection died — keep the original error.
            }
          }
          throw err;
        }
        console.log(`[migrate] applied ${name}`);
        count += 1;
      }
      console.log(
        count
          ? `[migrate] done — ${count} migration(s) applied.`
          : "[migrate] up to date.",
      );
    });
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[migrate] failed:", err?.message || err);
  // pg errors carry the context needed to debug a bad SQL file.
  for (const key of [
    "code",
    "constraint",
    "schema",
    "table",
    "detail",
    "hint",
    "position",
    "where",
  ]) {
    if (err?.[key] != null) console.error(`[migrate]   ${key}: ${err[key]}`);
  }
  process.exit(1);
});
