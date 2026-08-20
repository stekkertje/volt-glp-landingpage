import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Hostinger uses a Node 22 Nitro node-server build without changing the Vercel default", async () => {
  const [packageText, viteConfig] = await Promise.all([
    read("package.json"),
    read("vite.config.ts"),
  ]);
  const packageJson = JSON.parse(packageText);

  assert.equal(packageJson.engines.node, "22.x");
  assert.equal(
    packageJson.scripts["build:hostinger"],
    "REQUIRE_DATABASE=1 NITRO_PRESET=node-server vite build && REQUIRE_DATABASE=1 npm run db:migrate",
  );
  assert.equal(packageJson.scripts.start, "node .output/server/index.mjs");
  assert.match(
    viteConfig,
    /preset:\s*process\.env\.NITRO_PRESET\?\.trim\(\)\s*\|\|\s*["']vercel["']/,
  );
  assert.match(viteConfig, /serverDir:\s*["']\.\/server["']/);
});

test("the Hostinger environment contract keeps noindex and required integrations enabled", async () => {
  const [example, rootRoute, middleware, addressGuard, addressConfig] =
    await Promise.all([
      read(".env.example"),
      read("src/routes/__root.tsx"),
      read("server/middleware/00-security-headers.ts"),
      read("server/middleware/01-address-validation-guard.ts"),
      read("src/lib/server/integrations/address-validation-config.server.ts"),
    ]);

  for (const name of [
    "NODE_ENV",
    "NPM_CONFIG_INCLUDE",
    "REQUIRE_DATABASE",
    "REQUIRE_MAIL",
    "REQUIRE_ADDRESS_VALIDATION",
    "DATABASE_URL",
    "MIGRATION_DATABASE_URL",
    "BETTER_AUTH_SECRET",
    "ORDER_ACCESS_TOKEN_SECRET",
    "ADMIN_PASSWORD",
    "ADMIN_PASSWORD_BASE64",
    "ADMIN_SESSION_SECRET",
    "VITE_AUTH_ENABLED",
    "VITE_OAUTH_ENABLED",
    "VITE_NO_INDEX",
    "NO_INDEX",
    "VITE_PUBLIC_HOSTNAME",
    "TRUST_HOSTINGER_PROXY",
    "SMTP_PASSWORD_BASE64",
    "APICHECK_API_KEY",
    "GOOGLE_ADDRESS_VALIDATION_API_KEY",
  ]) {
    assert.match(example, new RegExp(`^${name}=`, "m"), name);
  }
  assert.match(example, /^NODE_ENV=production$/m);
  assert.match(example, /^NPM_CONFIG_INCLUDE=dev$/m);
  assert.match(example, /^REQUIRE_DATABASE=1$/m);
  assert.match(example, /^REQUIRE_MAIL=1$/m);
  assert.match(example, /^REQUIRE_ADDRESS_VALIDATION=1$/m);
  assert.match(example, /^VITE_AUTH_ENABLED=true$/m);
  assert.match(example, /^VITE_OAUTH_ENABLED=false$/m);
  assert.match(example, /^SMTP_PASSWORD_BASE64=$/m);
  assert.match(example, /^GROK_AUTH_CLIENT_ID=$/m);
  assert.match(example, /^GROK_AUTH_CLIENT_SECRET=$/m);
  assert.match(example, /^TRUST_HOSTINGER_PROXY=1$/m);
  assert.match(rootRoute, /name:\s*["']robots["']/);
  assert.match(rootRoute, /noindex, nofollow, noarchive/);
  assert.match(middleware, /process\.env\.NO_INDEX\s*===\s*["']1["']/);
  assert.match(middleware, /process\.env\.VITE_NO_INDEX\s*===\s*["']1["']/);
  assert.match(
    addressGuard,
    /resolveAddressValidationConfiguration\(process\.env\)/,
  );
  assert.match(addressConfig, /APICHECK_API_KEY/);
  assert.match(addressConfig, /GOOGLE_ADDRESS_VALIDATION_API_KEY/);
  assert.match(addressConfig, /REQUIRE_ADDRESS_VALIDATION/);
});

test("the Hostinger build requires its database on both build stages", async () => {
  const packageJson = JSON.parse(await read("package.json"));
  assert.equal(
    (packageJson.scripts["build:hostinger"].match(/REQUIRE_DATABASE=1/g) ?? [])
      .length,
    2,
  );

  const environment = { ...process.env };
  for (const name of Object.keys(environment)) {
    if (/^PG/u.test(name)) delete environment[name];
  }
  Object.assign(environment, {
    NODE_ENV: "production",
    npm_lifecycle_event: "db:migrate",
    REQUIRE_DATABASE: "1",
    DATABASE_URL: "",
    DATABASE_URL_UNPOOLED: "",
    MIGRATION_DATABASE_URL: "",
    VERCEL: "",
    NETLIFY: "",
  });
  const result = spawnSync(process.execPath, ["scripts/migrate.mjs"], {
    cwd: process.cwd(),
    env: environment,
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /MIGRATION_DATABASE_URL/u);
});
