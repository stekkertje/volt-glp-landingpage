import assert from "node:assert/strict";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { createServer as createViteServer } from "vite";

let baseUrl;
let browser;
let resolveClientOAuthCapability;
let resolveServerOAuthCapability;
let vite;
let viteCacheDir;

async function availablePort() {
  const server = createNetServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Geen vrije OAuth-testpoort beschikbaar.");
  }
  const port = address.port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

before(async () => {
  Object.assign(process.env, {
    DATABASE_URL: "",
    DATABASE_URL_UNPOOLED: "",
    MIGRATION_DATABASE_URL: "",
    NEON_API_KEY: "",
    VERCEL: "",
    NETLIFY: "",
    REQUIRE_DATABASE: "",
    PGLITE_PREVIEW: "",
    NODE_ENV: "test",
    npm_lifecycle_event: "test",
    VITE_AUTH_ENABLED: "true",
    VITE_OAUTH_ENABLED: "false",
    GROK_AUTH_CLIENT_ID: "",
    GROK_AUTH_CLIENT_SECRET: "",
    BETTER_AUTH_SECRET:
      "oauth-capability-auth-secret-with-at-least-32-characters",
  });

  const port = await availablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  viteCacheDir = await mkdtemp(join(tmpdir(), "volt-oauth-capability-vite-"));
  vite = await createViteServer({
    cacheDir: viteCacheDir,
    logLevel: "silent",
    server: { host: "127.0.0.1", port, strictPort: true },
  });
  await vite.listen();
  ({ resolveClientOAuthCapability, resolveServerOAuthCapability } =
    await vite.ssrLoadModule("/src/lib/auth/oauth-capability.ts"));
  browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
});

after(async () => {
  try {
    await browser?.close();
  } finally {
    await vite?.close();
    if (viteCacheDir) await rm(viteCacheDir, { recursive: true, force: true });
  }
});

test("production OAuth is opt-in, complete and fail-closed", () => {
  assert.deepEqual(
    resolveServerOAuthCapability({
      NODE_ENV: "production",
      VITE_AUTH_ENABLED: "true",
      VITE_OAUTH_ENABLED: "false",
    }),
    { enabled: false, usePreviewCredentials: false },
  );
  assert.throws(
    () =>
      resolveServerOAuthCapability({
        NODE_ENV: "production",
        VITE_AUTH_ENABLED: "true",
        VITE_OAUTH_ENABLED: "true",
        GROK_AUTH_CLIENT_ID: "alleen-een-id",
      }),
    /GROK_AUTH_CLIENT_SECRET ontbreekt/,
  );
  assert.deepEqual(
    resolveServerOAuthCapability({
      NODE_ENV: "production",
      VITE_AUTH_ENABLED: "true",
      VITE_OAUTH_ENABLED: "true",
      GROK_AUTH_CLIENT_ID: "productie-client",
      GROK_AUTH_CLIENT_SECRET: "productie-secret",
    }),
    { enabled: true, usePreviewCredentials: false },
  );
  assert.deepEqual(resolveServerOAuthCapability({ NODE_ENV: "test" }), {
    enabled: true,
    usePreviewCredentials: true,
  });
  for (const deployedEnvironment of [
    { REQUIRE_DATABASE: "1" },
    { DATABASE_URL: "postgresql://example.invalid/volt" },
    { BETTER_AUTH_URL: "https://afslank-injecties.nl" },
    { VITE_PUBLIC_HOSTNAME: "afslank-injecties.nl" },
  ]) {
    assert.deepEqual(resolveServerOAuthCapability(deployedEnvironment), {
      enabled: false,
      usePreviewCredentials: false,
    });
  }
  assert.equal(
    resolveClientOAuthCapability({
      authEnabled: true,
      explicitFlag: "false",
      isPreviewHost: true,
    }),
    false,
  );
  assert.equal(
    resolveClientOAuthCapability({
      authEnabled: true,
      explicitFlag: undefined,
      isPreviewHost: false,
    }),
    false,
  );
  assert.equal(
    resolveClientOAuthCapability({
      authEnabled: true,
      explicitFlag: undefined,
      isPreviewHost: true,
    }),
    true,
  );
});

test("production configuration without OAuth shows only email login", async () => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Inloggen" }).waitFor();
    await page.getByLabel("E-mailadres").waitFor();
    await page.getByLabel("Wachtwoord").waitFor();
    assert.equal(
      await page.getByRole("button", { name: /Doorgaan met/ }).count(),
      0,
    );
    assert.equal(await page.getByText("of met e-mailadres").count(), 0);
  } finally {
    await context.close();
  }
});
