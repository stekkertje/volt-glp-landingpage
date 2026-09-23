import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

const TEST_ADMIN_PASSWORD = `beheer-${randomUUID()}`;
const TEST_ADMIN_SESSION_SECRET = `${randomUUID()}-${randomUUID()}`;
const TEST_DATABASE_SOURCE_MARKER =
  "[app-builder] verified database source: pglite";

let baseUrl;
let addressApiServer;
let browser;
let devServer;
let serverOutput = "";
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
    throw new Error("Geen vrije browsertestpoort beschikbaar");
  }
  const port = address.port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (devServer?.exitCode !== null) {
      throw new Error(
        `VOLT auth-disabled testserver stopte tijdens opstarten:\n${serverOutput}`,
      );
    }
    try {
      const response = await fetch(baseUrl);
      if (response.ok && serverOutput.includes(TEST_DATABASE_SOURCE_MARKER)) {
        return;
      }
    } catch {
      // De server start nog.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `VOLT auth-disabled testserver werd niet tijdig klaar:\n${serverOutput}`,
  );
}

async function signalProcessGroupAndWait(child, signal, timeout) {
  return new Promise((resolve) => {
    let timer;
    const finish = (exited) => {
      clearTimeout(timer);
      child.off("exit", onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    child.once("exit", onExit);
    timer = setTimeout(() => finish(false), timeout);
    try {
      process.kill(-child.pid, signal);
    } catch {
      finish(true);
    }
  });
}

async function stopDevServer() {
  if (
    !devServer?.pid ||
    devServer.exitCode !== null ||
    devServer.signalCode !== null
  ) {
    return;
  }
  const exited = await signalProcessGroupAndWait(devServer, "SIGTERM", 5_000);
  if (!exited && devServer.exitCode === null) {
    await signalProcessGroupAndWait(devServer, "SIGKILL", 2_000);
  }
}

async function newPage(viewport = { width: 1280, height: 800 }) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(() => {
    localStorage.setItem("volt-cookie-consent", "accepted");
  });
  return { context, page: await context.newPage() };
}

async function fillCheckout(page) {
  await page.getByLabel("Naam").fill("Noor de Vries");
  await page
    .getByLabel("E-mail")
    .fill(`auth-disabled-${randomUUID()}@example.test`);
  await page.getByLabel("Straat").fill("Teststraat");
  await page.getByLabel("Huisnummer").fill("12 A");
  await page.getByLabel("Postcode").fill("1234 AB");
  await page.getByLabel("Plaats").fill("Utrecht");
  await page.getByLabel("Land").selectOption("NL");
}

before(async () => {
  addressApiServer = createHttpServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const number = url.searchParams.get("number") ?? "12";
    const addition = url.searchParams.get("numberAddition") ?? "";
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        data: {
          street: "Teststraat",
          number,
          numberAddition: addition,
          postalcode: "1234AB",
          city: "Utrecht",
        },
      }),
    );
  });
  await new Promise((resolve, reject) => {
    addressApiServer.once("error", reject);
    addressApiServer.listen(0, "127.0.0.1", resolve);
  });
  const address = addressApiServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Geen adres-API-testpoort beschikbaar");
  }
  const addressApiBaseUrl = `http://127.0.0.1:${address.port}`;
  const port = await availablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  viteCacheDir = await mkdtemp(join(tmpdir(), "volt-auth-disabled-vite-"));
  devServer = spawn(
    "npm",
    ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: "",
        MIGRATION_DATABASE_URL: "",
        DATABASE_URL_UNPOOLED: "",
        NEON_API_KEY: "",
        BETTER_AUTH_SECRET: "",
        ORDER_ACCESS_TOKEN_SECRET: "",
        ADDRESS_VALIDATION_TOKEN_SECRET: `${randomUUID()}-${randomUUID()}`,
        ORDER_ACCESS_TOKEN_PREVIOUS_SECRETS: "",
        MAILBOX_ADDRESS: "",
        MAILBOX_PASSWORD: "",
        MAIL_TEST_RECIPIENT: "",
        HOSTINGER_API_TOKEN: "",
        CLOUDFLARE_API_TOKEN: "",
        VERCEL: "",
        NETLIFY: "",
        REQUIRE_DATABASE: "",
        PGLITE_PREVIEW: "",
        NODE_ENV: "test",
        npm_lifecycle_event: "test",
        VOLT_TEST_EXPECT_DB_SOURCE: "pglite",
        VOLT_TEST_VITE_CACHE_DIR: viteCacheDir,
        APICHECK_API_KEY: "auth-disabled-test-key",
        APICHECK_BASE_URL: addressApiBaseUrl,
        VITE_AUTH_ENABLED: "false",
        VITE_OAUTH_ENABLED: "false",
        ADMIN_EMAILS: "niet-gebruikt@example.test",
        ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
        ADMIN_SESSION_SECRET: TEST_ADMIN_SESSION_SECRET,
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    },
  );
  for (const stream of [devServer.stdout, devServer.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      serverOutput = `${serverOutput}${chunk}`.slice(-20_000);
    });
  }
  await waitForServer();
  browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
});

after(async () => {
  try {
    await browser?.close();
  } finally {
    await stopDevServer();
    if (addressApiServer) {
      await new Promise((resolve) => addressApiServer.close(() => resolve()));
    }
    if (viteCacheDir) {
      await rm(viteCacheDir, { recursive: true, force: true });
    }
  }
});

test("auth-disabled deployment toont geen niet-werkende accountacties", async () => {
  const { context, page } = await newPage({ width: 390, height: 844 });
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });
    await page.waitForURL(`${baseUrl}/account`);
    await page
      .getByRole("heading", { name: "Account tijdelijk niet beschikbaar" })
      .waitFor();
    assert.equal(await page.getByRole("link", { name: "Inloggen" }).count(), 0);
    await page.getByText(/Neem contact op als je hulp nodig hebt/).waitFor();
    assert.equal(await page.getByLabel("Bestelnummer").count(), 0);
    assert.equal(await page.getByLabel("Herstelcode").count(), 0);
    assert.equal(
      await page.getByRole("button", { name: "Bestelling bekijken" }).count(),
      0,
    );
    assert.equal(
      await page.getByRole("link", { name: "Bestelling volgen" }).count(),
      0,
    );
    assert.equal(
      await page.getByRole("link", { name: "Account aanmaken" }).count(),
      0,
    );
    await page.goBack();
    await page.waitForURL(`${baseUrl}/`);
    assert.equal(new URL(page.url()).pathname, "/");
  } finally {
    await context.close();
  }
});

test("auth-disabled deployment houdt de wachtwoord-admin bereikbaar", async () => {
  const { context, page } = await newPage({ width: 390, height: 844 });
  try {
    await page.goto(`${baseUrl}/login?redirect=/admin`, {
      waitUntil: "networkidle",
    });
    await page.waitForURL(`${baseUrl}/admin`);
    await page.getByRole("heading", { name: "Inloggen" }).waitFor();
    assert.equal(
      await page
        .getByRole("link", {
          name: /Inloggen met (account|toegestaan account)/,
        })
        .count(),
      0,
    );
    await page.getByLabel("Beheerwachtwoord").fill(TEST_ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Inloggen" }).click();
    await page.getByRole("heading", { name: "Shopbeheer" }).waitFor();
    assert.equal(await page.title(), "Beheer | Afslank-injecties.nl");
    const brandLink = page.getByRole("link", {
      name: /Afslank-injecties\.nl\s+Beheer/,
    });
    const storeLink = page.getByRole("link", { name: "Terug naar winkel" });
    await brandLink.waitFor();
    const [brandBox, storeBox] = await Promise.all([
      brandLink.boundingBox(),
      storeLink.boundingBox(),
    ]);
    assert.ok(brandBox && storeBox);
    assert.ok(brandBox.x + brandBox.width <= storeBox.x);
    assert.equal(await page.getByText(/^VOLT/).count(), 0);
  } finally {
    await context.close();
  }
});

test("auth-disabled deployment plaatst een gastbestelling zonder accountomweg", async () => {
  const { context, page } = await newPage();
  try {
    await page.goto(`${baseUrl}/product/semaglutide-4mg-pen`, {
      waitUntil: "networkidle",
    });
    await page
      .getByRole("button", { name: /^In winkelwagen/ })
      .first()
      .click();
    await page.getByRole("link", { name: "Veilig afrekenen" }).click();
    await page.waitForURL(`${baseUrl}/checkout`);
    assert.equal(
      await page.getByText("Je plaatst de bestelling als gast.").count(),
      0,
    );
    await fillCheckout(page);
    try {
      await Promise.all([
        page.waitForURL(/\/bestelling\/[^/]+$/, {
          timeout: 15_000,
          waitUntil: "commit",
        }),
        page.getByRole("button", { name: "Bestelling plaatsen" }).click(),
      ]);
    } catch (error) {
      const alerts = await page.getByRole("alert").allInnerTexts();
      throw new Error(
        `Gastcheckout navigeerde niet. URL=${page.url()} meldingen=${JSON.stringify(alerts)} server=${serverOutput}`,
        { cause: error },
      );
    }

    const orderNumber = (await page.getByText(/^MED-\d+$/).innerText()).trim();
    assert.match(orderNumber, /^MED-\d+$/);
    await page.getByRole("heading", { level: 1, name: orderNumber }).waitFor();
    assert.equal(await page.locator("code").count(), 0);
    assert.equal(await page.getByText(/herstelcode/i).count(), 0);
    assert.equal(await page.getByText(/via je account openen/i).count(), 0);

    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("heading", { level: 1, name: orderNumber }).waitFor();

    await page.goto(`${baseUrl}/account`, { waitUntil: "networkidle" });
    await page
      .getByRole("heading", { name: "Account tijdelijk niet beschikbaar" })
      .waitFor();
    assert.equal(await page.getByLabel("Herstelcode").count(), 0);
  } finally {
    await context.close();
  }
});
