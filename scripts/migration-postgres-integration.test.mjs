import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { test } from "node:test";
import pg from "pg";
import { MIGRATION_STATEMENT_LOCK_TIMEOUT_MS } from "./migration-database.mjs";

const postgresTestUrl = process.env.TEST_MIGRATION_DATABASE_URL?.trim();

function integrationClient(connectionString) {
  return new pg.Client({
    connectionString,
    connectionTimeoutMillis: 5_000,
    query_timeout: 5_000,
    statement_timeout: 5_000,
  });
}

async function closeIntegrationClient(client) {
  if (!client) return;
  const closing = Promise.resolve().then(() => client.end());
  void closing.catch(() => undefined);
  let timer;
  try {
    await Promise.race([
      closing,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("PostgreSQL-testclient sloot niet tijdig")),
          2_000,
        );
      }),
    ]);
  } catch {
    try {
      client?.connection?.stream?.destroy();
    } catch {
      // Best effort after the bounded public close timed out.
    }
  } finally {
    clearTimeout(timer);
  }
}

function runMigrator(connectionString) {
  return spawnSync(process.execPath, ["scripts/migrate.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 25_000,
    env: {
      ...process.env,
      DATABASE_URL: "",
      DATABASE_URL_UNPOOLED: "",
      MIGRATION_DATABASE_URL: connectionString,
      PGAPPNAME: "",
      PGBINARY: "",
      PGCLIENT_ENCODING: "",
      PGCLIENTENCODING: "",
      PGCONNECT_TIMEOUT: "",
      PGDATABASE: "",
      PGHOST: "",
      PGOPTIONS: "",
      PGPASSFILE: "",
      PGPASSWORD: "",
      PGPORT: "",
      PGREPLICATION: "",
      PGSERVICE: "",
      PGSERVICEFILE: "",
      PGSSLMODE: "",
      PGSSLNEGOTIATION: "",
      PGUSER: "",
      NODE_ENV: "test",
      VERCEL: "",
      NETLIFY: "",
      REQUIRE_DATABASE: "",
      npm_lifecycle_event: "db:migrate",
    },
  });
}

test(
  "production migrator applies 0007 concurrently and reruns idempotently on PostgreSQL",
  {
    skip: postgresTestUrl ? false : "TEST_MIGRATION_DATABASE_URL ontbreekt",
    timeout: 90_000,
  },
  async () => {
    const schema = `migration_integration_${process.pid}`;
    assert.match(schema, /^[a-z_][a-z0-9_]*$/);
    const quotedSchema = `"${schema}"`;
    const integrationUrl = new URL(postgresTestUrl);
    const existingOptions = integrationUrl.searchParams.get("options")?.trim();
    integrationUrl.searchParams.set(
      "options",
      `${existingOptions ? `${existingOptions} ` : ""}-c search_path=${schema}`,
    );
    const connectionString = integrationUrl.toString();
    const admin = integrationClient(postgresTestUrl);
    let adminConnected = false;
    let verification;

    try {
      await admin.connect();
      adminConnected = true;
      await admin.query(`create schema ${quotedSchema}`);

      const first = runMigrator(connectionString);
      assert.equal(
        first.status,
        0,
        `eerste PostgreSQL-migratie faalde: ${first.error?.message ?? "onbekend"}\n${first.stdout}\n${first.stderr}`,
      );
      assert.match(first.stdout, /applied 0007_review_hardening\.sql/);

      const second = runMigrator(connectionString);
      assert.equal(
        second.status,
        0,
        `tweede PostgreSQL-migratie faalde: ${second.error?.message ?? "onbekend"}\n${second.stdout}\n${second.stderr}`,
      );
      assert.match(second.stdout, /up to date/i);

      verification = integrationClient(connectionString);
      await verification.connect();
      const expectedMigrations = (await readdir("migrations"))
        .filter((name) => name.endsWith(".sql"))
        .sort();
      const applied = await verification.query(
        "select name from _migrations order by name",
      );
      assert.deepEqual(
        applied.rows.map((row) => row.name),
        expectedMigrations,
      );
      const index = await verification.query(`
        select i.indisvalid, i.indisunique
        from pg_index i
        join pg_class c on c.oid = i.indexrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = current_schema()
          and c.relname = 'order_lines_order_variant_uidx'
      `);
      assert.deepEqual(index.rows, [{ indisvalid: true, indisunique: true }]);
      const schemaState = await verification.query(`
        select current_schema() as current_schema,
          exists (
            select 1 from information_schema.columns
            where table_schema = current_schema()
              and table_name = 'order_access_tokens'
              and column_name = 'token_ciphertext'
          ) as token_ciphertext_present,
          exists (
            select 1 from information_schema.columns
            where table_schema = current_schema()
              and table_name = 'orders'
              and column_name = 'guest_access_token_hash'
          ) as legacy_hash_present
      `);
      assert.deepEqual(schemaState.rows, [
        {
          current_schema: schema,
          token_ciphertext_present: true,
          legacy_hash_present: false,
        },
      ]);
    } finally {
      await closeIntegrationClient(verification);
      try {
        if (adminConnected) {
          await admin
            .query(`drop schema if exists ${quotedSchema} cascade`)
            .catch((error) => {
              throw new Error(
                `Integratietestschema kon niet worden opgeruimd: ${error?.message ?? "onbekend"}`,
              );
            });
          const cleanup = await admin.query(
            "select to_regnamespace($1) is null as dropped",
            [schema],
          );
          assert.equal(cleanup.rows[0]?.dropped, true);
        }
      } finally {
        await closeIntegrationClient(admin);
      }
    }
  },
);

test(
  "production migrator bounds ordinary PostgreSQL lock waits without a statement timeout",
  {
    skip: postgresTestUrl ? false : "TEST_MIGRATION_DATABASE_URL ontbreekt",
    timeout: 75_000,
  },
  async () => {
    const schema = `migration_lock_timeout_${process.pid}`;
    assert.match(schema, /^[a-z_][a-z0-9_]*$/);
    const quotedSchema = `"${schema}"`;
    const integrationUrl = new URL(postgresTestUrl);
    integrationUrl.searchParams.set("options", `-c search_path=${schema}`);
    const connectionString = integrationUrl.toString();
    const admin = integrationClient(postgresTestUrl);
    const blocker = integrationClient(connectionString);
    let adminConnected = false;
    let blockerConnected = false;
    let blockerInTransaction = false;

    try {
      await admin.connect();
      adminConnected = true;
      await admin.query(`create schema ${quotedSchema}`);
      const initial = runMigrator(connectionString);
      assert.equal(
        initial.status,
        0,
        `initiële PostgreSQL-migratie faalde:\n${initial.stdout}\n${initial.stderr}`,
      );
      await admin.query(
        `delete from ${quotedSchema}._migrations where name = $1`,
        ["0005_orders_user_index.sql"],
      );

      await blocker.connect();
      blockerConnected = true;
      await blocker.query("begin");
      blockerInTransaction = true;
      await blocker.query("lock table orders in access exclusive mode");

      const startedAt = Date.now();
      const blocked = runMigrator(connectionString);
      const elapsed = Date.now() - startedAt;
      const blockedOutput = `${blocked.stdout}\n${blocked.stderr}`;
      assert.notEqual(blocked.status, 0);
      assert.notEqual(
        blocked.error?.code,
        "ETIMEDOUT",
        `migrator werd door de child-procesdeadline beëindigd:\n${blockedOutput}`,
      );
      assert.match(blockedOutput, /lock timeout|55P03/i);
      assert.ok(
        elapsed >= MIGRATION_STATEMENT_LOCK_TIMEOUT_MS - 1_000,
        `database-locktimeout was te kort: ${elapsed}ms`,
      );
      assert.ok(elapsed < 23_000, `database-locktimeout hing: ${elapsed}ms`);
      const untracked = await admin.query(
        `select count(*)::int as count from ${quotedSchema}._migrations where name = $1`,
        ["0005_orders_user_index.sql"],
      );
      assert.equal(untracked.rows[0]?.count, 0);

      await blocker.query("rollback");
      blockerInTransaction = false;
      const retry = runMigrator(connectionString);
      assert.equal(
        retry.status,
        0,
        `retry na lockvrijgave faalde:\n${retry.stdout}\n${retry.stderr}`,
      );
      assert.match(retry.stdout, /applied 0005_orders_user_index\.sql/);
      const tracked = await admin.query(
        `select count(*)::int as count from ${quotedSchema}._migrations where name = $1`,
        ["0005_orders_user_index.sql"],
      );
      assert.equal(tracked.rows[0]?.count, 1);
    } finally {
      if (blockerInTransaction) {
        await blocker.query("rollback").catch(() => undefined);
      }
      await closeIntegrationClient(blockerConnected ? blocker : undefined);
      try {
        if (adminConnected) {
          await admin.query(`drop schema if exists ${quotedSchema} cascade`);
        }
      } finally {
        await closeIntegrationClient(adminConnected ? admin : undefined);
      }
    }
  },
);
