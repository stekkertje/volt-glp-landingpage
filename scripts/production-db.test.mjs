import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let vite;
let resolveDatabasePolicy;

before(async () => {
  vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ resolveDatabasePolicy } = await vite.ssrLoadModule(
    "/src/lib/db-policy.ts",
  ));
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

test("local development, tests and explicit preview may use PGLite", () => {
  assert.equal(
    resolveDatabasePolicy({ NODE_ENV: "development", DATABASE_URL: "" }).source,
    "pglite",
  );
  assert.equal(
    resolveDatabasePolicy({ NODE_ENV: "test", DATABASE_URL: "" }).source,
    "pglite",
  );
  assert.equal(
    resolveDatabasePolicy({
      NODE_ENV: "production",
      PGLITE_PREVIEW: "true",
      DATABASE_URL: "",
    }).source,
    "pglite",
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

test("the deployment migrator exits non-zero without DATABASE_URL", () => {
  const result = spawnSync(process.execPath, ["scripts/migrate.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "production",
      VERCEL: "1",
      DATABASE_URL: "",
      PGLITE_PREVIEW: "",
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /DATABASE_URL/);
});

test("the migrator permits an explicitly marked ephemeral preview", () => {
  const result = spawnSync(process.execPath, ["scripts/migrate.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "production",
      VERCEL: "1",
      DATABASE_URL: "",
      PGLITE_PREVIEW: "true",
    },
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /PGLite preview/);
});
