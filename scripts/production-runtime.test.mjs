import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("built production runtime fails closed before loading PGLite assets", () => {
  const build = spawnSync("npm", ["run", "build"], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 120_000,
    env: {
      ...process.env,
      DATABASE_URL: "",
      PGLITE_PREVIEW: "",
    },
  });
  assert.equal(
    build.status,
    0,
    `production fixture build failed:\n${build.stdout}\n${build.stderr}`,
  );

  const runtime = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
        try {
          const { default: app } = await import(
            "./.vercel/output/functions/__server.func/index.mjs"
          );
          await app.fetch(new Request("http://localhost/admin"), {});
          console.error("runtime unexpectedly served without DATABASE_URL");
          process.exit(2);
        } catch (error) {
          const text = String(error?.stack || error);
          console.error(text);
          process.exit(
            /DATABASE_URL/.test(text) && !/ENOENT.*pglite\\.data/i.test(text)
              ? 0
              : 1
          );
        }
      `,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 30_000,
      env: {
        ...process.env,
        NODE_ENV: "production",
        DATABASE_URL: "",
        PGLITE_PREVIEW: "true",
        VERCEL: "",
        NETLIFY: "",
        REQUIRE_DATABASE: "",
        npm_lifecycle_event: "",
      },
    },
  );
  assert.equal(
    runtime.status,
    0,
    `built runtime did not fail closed:\n${runtime.stdout}\n${runtime.stderr}`,
  );
  assert.match(`${runtime.stdout}\n${runtime.stderr}`, /DATABASE_URL/);
  assert.doesNotMatch(
    `${runtime.stdout}\n${runtime.stderr}`,
    /ENOENT.*pglite\.data/i,
  );
});
