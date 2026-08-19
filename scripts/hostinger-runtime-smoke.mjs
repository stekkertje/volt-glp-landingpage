import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { createServer } from "node:net";
import { chromium } from "playwright";

const entryFile = new URL("../.output/server/index.mjs", import.meta.url);
await access(entryFile);

async function availablePort() {
  const listener = createServer();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const address = listener.address();
  assert.ok(address && typeof address !== "string");
  await new Promise((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

const port = await availablePort();
const baseUrl = `http://127.0.0.1:${port}`;
let output = "";
let browser;
const serverEnvironment = { ...process.env };
for (const name of [
  "MIGRATION_DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "NEON_API_KEY",
  "ORDER_ACCESS_TOKEN_PREVIOUS_SECRETS",
  "MAILBOX_ADDRESS",
  "MAILBOX_PASSWORD",
  "MAIL_TEST_RECIPIENT",
  "HOSTINGER_API_TOKEN",
  "CLOUDFLARE_API_TOKEN",
]) {
  delete serverEnvironment[name];
}
Object.assign(serverEnvironment, {
  NODE_ENV: "production",
  HOST: "127.0.0.1",
  PORT: String(port),
  REQUIRE_DATABASE: "1",
  VITE_AUTH_ENABLED: "false",
  VITE_NO_INDEX: "1",
  NO_INDEX: "1",
  VITE_PUBLIC_HOSTNAME: "afslank-injecties.nl",
  TRUST_HOSTINGER_PROXY: "1",
  BETTER_AUTH_SECRET: "ci-better-auth-secret-32-characters-minimum",
  ORDER_ACCESS_TOKEN_SECRET: "ci-order-access-secret-32-characters-minimum",
  ADMIN_PASSWORD: "ci-admin-password-strong",
  ADMIN_SESSION_SECRET: "ci-admin-session-secret-32-characters-minimum",
  ADMIN_EMAILS: "",
});
const server = spawn(process.execPath, [entryFile.pathname], {
  detached: true,
  env: serverEnvironment,
  stdio: ["ignore", "pipe", "pipe"],
});
for (const stream of [server.stdout, server.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    output = `${output}${chunk}`.slice(-20_000);
  });
}

async function stopServer() {
  if (!server.pid || server.exitCode !== null) return;
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    return;
  }
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  if (server.exitCode === null) {
    try {
      process.kill(-server.pid, "SIGKILL");
    } catch {
      // De server was ondertussen gesloten.
    }
  }
}

async function fetchPage(path, options) {
  return fetch(`${baseUrl}${path}`, {
    signal: AbortSignal.timeout(10_000),
    ...options,
  });
}

try {
  const deadline = Date.now() + 20_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Hostinger-runtime stopte tijdens opstarten:\n${output}`);
    }
    try {
      const response = await fetchPage("/");
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      // De server start nog.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(ready, `Hostinger-runtime startte niet tijdig:\n${output}`);

  for (const path of [
    "/",
    "/product/semaglutide-4mg-pen",
    "/checkout",
    "/admin",
  ]) {
    const response = await fetchPage(path);
    assert.equal(response.status, 200, `${path} moet HTTP 200 geven`);
    assert.equal(
      response.headers.get("x-robots-tag"),
      "noindex, nofollow, noarchive",
      `${path} mist X-Robots-Tag`,
    );
    assert.match(
      await response.text(),
      /<meta[^>]+name=["']robots["'][^>]+noindex, nofollow, noarchive/i,
      `${path} mist robots-meta`,
    );
  }

  const forwardedHttpsResponse = await fetchPage("/", {
    headers: {
      "x-forwarded-host": "afslank-injecties.nl",
      "x-forwarded-proto": "https",
    },
  });
  assert.equal(forwardedHttpsResponse.status, 200);
  assert.equal(
    forwardedHttpsResponse.headers.get("strict-transport-security"),
    "max-age=31536000",
    "Hostinger HTTPS-proxy mist HSTS",
  );
  await forwardedHttpsResponse.arrayBuffer();

  browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  let proxiedMutationSeen = false;
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname.startsWith("/_server")
    ) {
      proxiedMutationSeen = true;
      const headers = { ...request.headers() };
      delete headers["content-length"];
      const response = await fetch(request.url(), {
        method: request.method(),
        headers: {
          ...headers,
          origin: "https://afslank-injecties.nl",
          referer: "https://afslank-injecties.nl/",
          "sec-fetch-site": "same-origin",
          "x-forwarded-host": "afslank-injecties.nl",
          "x-forwarded-proto": "https",
        },
        body: request.postDataBuffer(),
      });
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: Buffer.from(await response.arrayBuffer()),
      });
      return;
    }
    await route.continue();
  });
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page
    .locator("footer")
    .getByRole("button", { name: "Contact", exact: true })
    .click();
  await page.locator("#contact-name").fill("Hostinger productiecontrole");
  await page.locator("#contact-email").fill("hostinger-smoke@example.test");
  await page
    .locator("#contact-message")
    .fill("Gerichte controle van de Hostinger HTTPS-proxy.");
  const mutationResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.startsWith("/_server"),
  );
  await page.getByRole("button", { name: "Verstuur bericht" }).click();
  const mutationResponse = await mutationResponsePromise;
  const mutationBody = await mutationResponse.text();
  assert.equal(
    mutationResponse.status(),
    200,
    `Hostinger proxy-POST gaf ${mutationResponse.status()}: ${mutationBody.slice(0, 500)}`,
  );
  try {
    await page
      .getByText("Bericht verstuurd", { exact: true })
      .waitFor({ timeout: 10_000 });
  } catch (error) {
    const feedback = await page.locator('[role="alert"]').allTextContents();
    throw new Error(
      `Contact-UI bevestigde de proxy-POST niet: ${feedback.join(" | ") || "geen foutmelding"}`,
      { cause: error },
    );
  }
  assert.equal(
    proxiedMutationSeen,
    true,
    "De production smoke heeft geen server-function POST gezien",
  );
  await context.close();

  const loginResponse = await fetchPage("/login");
  assert.equal(loginResponse.status, 200);
  assert.equal(new URL(loginResponse.url).pathname, "/account");
  assert.equal(
    loginResponse.headers.get("x-robots-tag"),
    "noindex, nofollow, noarchive",
  );
  process.stdout.write("Hostinger node-server production smoke is groen.\n");
} finally {
  try {
    await browser?.close();
  } finally {
    await stopServer();
  }
}
