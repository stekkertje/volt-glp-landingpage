import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import pg from "pg";

let vite;
let postgresConnectionConfig;
let resolveDatabasePolicy;

before(async () => {
  vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ postgresConnectionConfig, resolveDatabasePolicy } =
    await vite.ssrLoadModule("/src/lib/db-policy.ts"));
});

after(async () => {
  await vite?.close();
});

test("a real production deployment requires DATABASE_URL", () => {
  assert.throws(
    () =>
      resolveDatabasePolicy({
        NODE_ENV: "production",
        VERCEL: "1",
        PGLITE_PREVIEW: "true",
        DATABASE_URL: "",
      }),
    /DATABASE_URL/,
  );

  assert.throws(
    () =>
      resolveDatabasePolicy({
        NODE_ENV: "production",
        DATABASE_URL: "",
      }),
    /DATABASE_URL/,
  );
});

test("only development, tests and local builds may use PGLite", () => {
  assert.equal(
    resolveDatabasePolicy({ NODE_ENV: "development", DATABASE_URL: "" }).source,
    "pglite",
  );
  assert.equal(
    resolveDatabasePolicy({ NODE_ENV: "test", DATABASE_URL: "" }).source,
    "pglite",
  );
  assert.throws(
    () =>
      resolveDatabasePolicy({
        NODE_ENV: "production",
        PGLITE_PREVIEW: "true",
        DATABASE_URL: "",
      }),
    /DATABASE_URL/,
  );
  assert.equal(
    resolveDatabasePolicy({
      NODE_ENV: "production",
      npm_lifecycle_event: "build",
      DATABASE_URL: "",
    }).source,
    "pglite",
  );
});

test("a configured deployment always selects the persistent database", () => {
  const policy = resolveDatabasePolicy({
    NODE_ENV: "production",
    VERCEL: "1",
    DATABASE_URL: "postgres://example.invalid/database",
  });
  assert.equal(policy.source, "neon");
  assert.equal(policy.databaseUrl, "postgres://example.invalid/database");
});

test("runtime and auth Pool configs pin public unless the URL sets search_path", async () => {
  const defaultUrl = "postgresql://user:secret@database.example.test/volt";
  const defaultConfig = postgresConnectionConfig(defaultUrl);
  assert.equal(defaultConfig.connectionString, defaultUrl);
  assert.equal(defaultConfig.options, "-c search_path=public");

  const endpointOnlyUrl =
    "postgresql://user:secret@ep-name.neon.tech/volt?sslmode=require&options=endpoint%3Dep-name";
  const endpointOnlyConfig = postgresConnectionConfig(endpointOnlyUrl);
  assert.doesNotMatch(endpointOnlyConfig.connectionString, /options=/);
  assert.equal(
    endpointOnlyConfig.options,
    "endpoint=ep-name -c search_path=public",
  );

  const customUrl =
    "postgresql://user:secret@database.example.test/volt?options=-c%20search_path%3Dshop_schema";
  const customConfig = postgresConnectionConfig(customUrl);
  assert.doesNotMatch(customConfig.connectionString, /options=/);
  assert.equal(customConfig.options, "-c search_path=shop_schema");

  for (const [config, expected] of [
    [defaultConfig, "-c search_path=public"],
    [endpointOnlyConfig, "endpoint=ep-name -c search_path=public"],
    [customConfig, "-c search_path=shop_schema"],
  ]) {
    const pool = new pg.Pool(config);
    try {
      const client = new pool.Client(pool.options);
      assert.equal(client.connectionParameters.options, expected);
    } finally {
      await pool.end();
    }
  }

  const [runtimeSource, authSource] = await Promise.all([
    readFile("src/lib/db.ts", "utf8"),
    readFile("src/lib/auth/server.ts", "utf8"),
  ]);
  assert.match(
    runtimeSource,
    /new Pool\(postgresConnectionConfig\(databaseUrl/,
  );
  assert.match(
    authSource,
    /new Pool\(postgresConnectionConfig\(databaseUrl\)\)/,
  );
});

test("the deployment migrator exits non-zero without DATABASE_URL", () => {
  const result = spawnSync(process.execPath, ["scripts/migrate.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "production",
      VERCEL: "1",
      DATABASE_URL: "",
      MIGRATION_DATABASE_URL: "",
      DATABASE_URL_UNPOOLED: "",
      PGLITE_PREVIEW: "",
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /DATABASE_URL/);
});

test("PGLITE_PREVIEW cannot bypass persistent storage in deployment", () => {
  const result = spawnSync(process.execPath, ["scripts/migrate.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "production",
      VERCEL: "1",
      DATABASE_URL: "",
      MIGRATION_DATABASE_URL: "",
      DATABASE_URL_UNPOOLED: "",
      PGLITE_PREVIEW: "true",
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /DATABASE_URL/);
});
