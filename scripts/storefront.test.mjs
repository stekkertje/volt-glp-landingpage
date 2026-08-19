import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

let BASE_URL;
const TEST_ADMIN_PASSWORD = `test-${randomUUID()}`;
const TEST_ADMIN_SESSION_SECRET = `session-${randomUUID()}-${randomUUID()}`;
let browser;
let devServer;
let serverOutput = "";
let viteCacheDir;
const TEST_DATABASE_SOURCE_MARKER =
  "[app-builder] verified database source: pglite";

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

async function isHealthy() {
  try {
    const response = await fetch(BASE_URL);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (devServer?.exitCode !== null) {
      throw new Error(
        `VOLT dev server stopte tijdens opstarten:\n${serverOutput}`,
      );
    }
    if (
      (await isHealthy()) &&
      serverOutput.includes(TEST_DATABASE_SOURCE_MARKER)
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`VOLT dev server werd niet tijdig klaar:\n${serverOutput}`);
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

async function startDevServer() {
  serverOutput = "";
  devServer = spawn(
    "npm",
    [
      "run",
      "dev",
      "--",
      "--host",
      "127.0.0.1",
      "--port",
      new URL(BASE_URL).port,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: "",
        MIGRATION_DATABASE_URL: "",
        DATABASE_URL_UNPOOLED: "",
        VERCEL: "",
        NETLIFY: "",
        REQUIRE_DATABASE: "",
        PGLITE_PREVIEW: "",
        NODE_ENV: "test",
        npm_lifecycle_event: "test",
        VOLT_TEST_EXPECT_DB_SOURCE: "pglite",
        VOLT_TEST_VITE_CACHE_DIR: viteCacheDir,
        ADMIN_EMAILS: "allowlisted-admin@example.test",
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
}

async function restartDevServerWithFreshDatabase() {
  await stopDevServer();
  await startDevServer();
}

async function within(promise, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function newPage(viewport = { width: 1280, height: 800 }) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(() => {
    if (!localStorage.getItem("volt-test-initialized")) {
      localStorage.clear();
      localStorage.setItem("volt-test-initialized", "true");
    }
    localStorage.setItem("volt-cookie-consent", "accepted");
  });
  const page = await context.newPage();
  return { context, page };
}

async function cartState(page) {
  return page.evaluate(
    () => JSON.parse(localStorage.getItem("volt-cart") || "{}").state,
  );
}

function serializedServerProperty(node, key) {
  const index = node?.p?.k?.indexOf(key) ?? -1;
  return index < 0 ? undefined : node.p.v[index];
}

before(async () => {
  const port = await availablePort();
  BASE_URL = `http://127.0.0.1:${port}`;
  viteCacheDir = await mkdtemp(join(tmpdir(), "volt-storefront-vite-"));
  await startDevServer();
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
    if (viteCacheDir) {
      await rm(viteCacheDir, { recursive: true, force: true });
    }
  }
});

test("document responses include central security and privacy headers", async () => {
  const home = await fetch(BASE_URL);
  assert.equal(home.headers.get("x-content-type-options"), "nosniff");
  assert.equal(
    home.headers.get("referrer-policy"),
    "strict-origin-when-cross-origin",
  );
  assert.match(
    home.headers.get("content-security-policy") ?? "",
    /default-src 'self'/,
  );
  assert.match(
    home.headers.get("content-security-policy") ?? "",
    /frame-ancestors/,
  );

  for (const path of [
    "/admin",
    "/account",
    "/checkout",
    "/bestelling/bestaat-niet",
  ]) {
    const response = await fetch(`${BASE_URL}${path}`);
    assert.match(
      response.headers.get("cache-control") ?? "",
      /no-store/i,
      path,
    );
    if (path === "/checkout") {
      const body = await response.text();
      assert.doesNotMatch(
        body,
        /Switched to client rendering because the server rendering errored|Cannot read properties of undefined/,
      );
    }
  }
  const install = await fetch(`${BASE_URL}/admin?install=1&platform=ios`);
  assert.match(install.headers.get("cache-control") ?? "", /no-store/i);
  assert.match(
    install.headers.get("content-security-policy") ?? "",
    /default-src 'self'/,
  );
});

test("a related product card always adds one item", async () => {
  const { context, page } = await newPage();
  try {
    await page.goto(`${BASE_URL}/product/semaglutide-2mg`, {
      waitUntil: "networkidle",
    });
    const increase = page.getByRole("button", { name: "Aantal verhogen" });
    for (let i = 0; i < 4; i += 1) await increase.click();

    const related = page
      .locator("section")
      .filter({ hasText: "Andere variant" });
    await related
      .getByRole("button", { name: "In winkelwagen" })
      .first()
      .click();

    const state = await cartState(page);
    assert.deepEqual(state.lines, [
      { slug: "semaglutide-4mg-pen", optionId: "default", qty: 1 },
    ]);
  } finally {
    await context.close();
  }
});

test("related products stay within the current compound", async () => {
  const { context, page } = await newPage();
  try {
    await page.goto(`${BASE_URL}/product/semaglutide-4mg-pen`, {
      waitUntil: "networkidle",
    });
    const related = page
      .locator("section")
      .filter({ hasText: "Andere variant" });
    const text = await related.innerText();

    assert.doesNotMatch(text, /Tirzepatide/);
    assert.doesNotMatch(text, /Retatrutide/);
  } finally {
    await context.close();
  }
});

test("an active discount must be removed before entering another code", async () => {
  const { context, page } = await newPage();
  try {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page
      .locator("#producten article")
      .filter({ hasText: "Semaglutide 4mg" })
      .getByRole("button", { name: "In winkelwagen" })
      .click();
    await page
      .getByRole("button", { name: "Heb je een kortingscode?" })
      .click();

    const input = page.getByRole("textbox", { name: "Kortingscode" });
    await input.fill("VOLT10");
    await page.getByRole("button", { name: "Toepassen" }).click();
    await page
      .getByRole("button", { name: "Kortingscode verwijderen" })
      .waitFor();

    const state = await cartState(page);
    assert.equal(state.discountApplied, true);
    assert.equal(state.discountCode, "VOLT10");
    assert.equal(await input.count(), 0);
  } finally {
    await context.close();
  }
});

test("checkout recovers from a persisted server-invalid discount code", async () => {
  const { context, page } = await newPage();
  try {
    await page.goto(`${BASE_URL}/product/semaglutide-4mg-pen`, {
      waitUntil: "networkidle",
    });
    await page
      .getByRole("button", { name: /^In winkelwagen/ })
      .first()
      .click();
    await page.evaluate(() => {
      const persisted = JSON.parse(localStorage.getItem("volt-cart") || "{}");
      persisted.state.discountCode = "INACTIEF";
      persisted.state.discountApplied = true;
      localStorage.setItem("volt-cart", JSON.stringify(persisted));
    });
    await page.goto(`${BASE_URL}/checkout`, { waitUntil: "networkidle" });

    const placeOrder = page.getByRole("button", {
      name: "Bestelling plaatsen",
    });
    await page
      .getByRole("alert")
      .getByText("De actuele totalen konden niet worden berekend.", {
        exact: true,
      })
      .waitFor();
    assert.equal(await placeOrder.isDisabled(), true);

    await page
      .getByRole("button", {
        name: "Kortingscode verwijderen en opnieuw berekenen",
      })
      .click();
    await waitForCheckoutSubmit(page);
    const state = await cartState(page);
    assert.equal(state.discountApplied, false);
    assert.equal(state.discountCode, "");

    await fillCheckout(page, `inactive-code-${randomUUID()}@example.test`);
    await placeOrder.click();
    await page.waitForURL(/\/bestelling\/[^/]+$/, { timeout: 15_000 });
    await page
      .getByRole("heading", { name: "Bewaar je herstelcode" })
      .waitFor();
  } finally {
    await context.close();
  }
});

test("the mobile sticky bar shows the cart summary", async () => {
  const { context, page } = await newPage({ width: 390, height: 844 });
  try {
    await page.goto(`${BASE_URL}/product/semaglutide-2mg`, {
      waitUntil: "networkidle",
    });
    await page
      .locator("#prijzen")
      .getByRole("button", { name: /^In winkelwagen/ })
      .click();
    await page.getByRole("button", { name: "Winkelwagen sluiten" }).click();

    const sticky = page.locator("div.fixed").filter({
      has: page.getByRole("button", { name: "Mandje" }),
    });
    await sticky.waitFor({ state: "visible" });
    const text = await sticky.innerText();
    assert.match(text, /Winkelwagen/);
    assert.match(text, /€\s?85,00/);
  } finally {
    await context.close();
  }
});

test("the PDP keeps its product-specific document title", async () => {
  const { context, page } = await newPage();
  try {
    await page.goto(`${BASE_URL}/product/semaglutide-2mg`, {
      waitUntil: "networkidle",
    });
    assert.equal(await page.title(), "Semaglutide 2mg kopen | VOLT");

    await page
      .getByRole("button", { name: /^In winkelwagen/ })
      .first()
      .click();
    assert.equal(await page.title(), "(1) Semaglutide 2mg kopen | VOLT");
  } finally {
    await context.close();
  }
});

test("the cart drawer moves focus inside and restores its opener", async () => {
  const { context, page } = await newPage();
  try {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    const opener = page
      .locator("#producten article")
      .filter({ hasText: "Semaglutide 4mg" })
      .getByRole("button", { name: "In winkelwagen" });
    const overflowBefore = await page.evaluate(
      () => document.body.style.overflow,
    );
    await opener.click();
    await page.waitForFunction(
      () =>
        document.activeElement?.getAttribute("aria-label") ===
        "Winkelwagen sluiten",
    );

    assert.equal(
      await page.evaluate(() =>
        document.activeElement?.getAttribute("aria-label"),
      ),
      "Winkelwagen sluiten",
    );
    assert.equal(
      await page.evaluate(() => document.body.style.overflow),
      "hidden",
    );
    await page.keyboard.press("Escape");
    assert.equal(
      await opener.evaluate((element) => element === document.activeElement),
      true,
    );
    assert.equal(
      await page.evaluate(() => document.body.style.overflow),
      overflowBefore,
    );
  } finally {
    await context.close();
  }
});

test("the contact dialog focuses the first field and restores its opener", async () => {
  const { context, page } = await newPage();
  try {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    const opener = page
      .getByRole("button", { name: "Contact", exact: true })
      .last();
    const overflowBefore = await page.evaluate(
      () => document.body.style.overflow,
    );
    await opener.click();
    await page.waitForFunction(
      () => document.activeElement?.getAttribute("name") === "name",
    );

    assert.equal(
      await page.evaluate(() => document.activeElement?.getAttribute("name")),
      "name",
    );
    assert.equal(
      await page.evaluate(() => document.body.style.overflow),
      "hidden",
    );
    await page.keyboard.press("Escape");
    assert.equal(
      await opener.evaluate((element) => element === document.activeElement),
      true,
    );
    assert.equal(
      await page.evaluate(() => document.body.style.overflow),
      overflowBefore,
    );
  } finally {
    await context.close();
  }
});

test("contact validation exposes field errors to assistive technology", async () => {
  const { context, page } = await newPage();
  try {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page
      .getByRole("button", { name: "Contact", exact: true })
      .last()
      .click();
    await page.getByRole("button", { name: "Verstuur bericht" }).click();

    for (const name of ["name", "email", "message"]) {
      const field = page.locator(`[name="${name}"]`);
      assert.equal(await field.getAttribute("aria-invalid"), "true");
      const errorId = await field.getAttribute("aria-describedby");
      assert.ok(errorId);
      assert.ok((await page.locator(`#${errorId}`).innerText()).length > 0);
    }
  } finally {
    await context.close();
  }
});

test("vial cards add the default option from the catalog", async () => {
  const { context, page } = await newPage();
  try {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    const vialCard = page
      .locator("#producten article")
      .filter({ hasText: "Semaglutide 2mg" });
    await vialCard.getByRole("link", { name: "Bekijk" }).waitFor({
      state: "visible",
    });
    await vialCard.getByRole("button", { name: "In winkelwagen" }).click();
    const state = await cartState(page);
    assert.equal(
      await vialCard.getByRole("link", { name: "Kies extra's" }).count(),
      0,
    );
    assert.deepEqual(state.lines, [
      { slug: "semaglutide-2mg", optionId: "none", qty: 1 },
    ]);
  } finally {
    await context.close();
  }
});

test("vial options state syringes are not included by default", async () => {
  const { context, page } = await newPage();
  try {
    await page.goto(`${BASE_URL}/product/semaglutide-2mg`, {
      waitUntil: "networkidle",
    });
    const syringeOption = page.getByRole("radio", {
      name: /10 insulinespuiten/,
    });
    assert.match(await syringeOption.innerText(), /Niet standaard inbegrepen/);
  } finally {
    await context.close();
  }
});

test("the mobile cookie offset matches the rendered banner height", async () => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  try {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    const banner = page.locator("div.fixed").filter({
      hasText: "We gebruiken alleen functionele cookies",
    });
    const bannerHeight = await banner.evaluate(
      (element) => element.getBoundingClientRect().height,
    );
    const offset = await page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement);
      const value = styles.getPropertyValue("--volt-cookie-h").trim();
      const number = Number.parseFloat(value);
      return value.endsWith("rem")
        ? number * Number.parseFloat(styles.fontSize)
        : number;
    });
    assert.ok(
      Math.abs(offset - bannerHeight) <= 1,
      `${offset}px offset for ${bannerHeight}px banner`,
    );
  } finally {
    await context.close();
  }
});

test("the functional-cookie notice offers one unambiguous action", async () => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  try {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    assert.equal(
      await page.getByRole("button", { name: "Begrepen" }).count(),
      1,
    );
    assert.equal(
      await page.getByRole("button", { name: "Accepteren" }).count(),
      0,
    );
  } finally {
    await context.close();
  }
});

test("the home sticky bar appears once the cart has items", async () => {
  const { context, page } = await newPage({ width: 390, height: 844 });
  try {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page
      .locator("#producten article")
      .filter({ hasText: "Semaglutide 4mg" })
      .getByRole("button", { name: "In winkelwagen" })
      .click();
    await page.getByRole("button", { name: "Winkelwagen sluiten" }).click();

    const sticky = page.locator("div.fixed").filter({
      has: page.getByRole("button", { name: "Mandje" }),
    });
    await sticky.waitFor({ state: "visible" });
    const text = await sticky.innerText();
    assert.match(text, /Winkelwagen/);
    assert.match(text, /€\s?169,00/);
  } finally {
    await context.close();
  }
});

test("the delivery promise uses the next workday around weekends", async () => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  await context.addInitScript(() => {
    const RealDate = Date;
    const fixed = new RealDate("2026-08-21T22:00:00.000Z").getTime();
    globalThis.Date = class extends RealDate {
      constructor(...args) {
        super(...(args.length ? args : [fixed]));
      }

      static now() {
        return fixed;
      }
    };
    localStorage.setItem("volt-cookie-consent", "accepted");
  });
  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}/product/semaglutide-2mg`, {
      waitUntil: "networkidle",
    });
    assert.match(
      await page.locator("#prijzen").locator("div").filter({
        hasText: "Bestel binnen:",
      }).first().innerText(),
      /Verzending:\s*maandag 24 aug/i,
    );
  } finally {
    await context.close();
  }
});

test("product previews and Retatrutide pen cards use the requested copy", async () => {
  const { context, page } = await newPage();
  try {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    const preview = page
      .locator("#producten article")
      .filter({ hasText: "Semaglutide 2mg" });
    const previewText = await preview.innerText();
    assert.ok(
      previewText.indexOf("Bio Amino Labs") <
        previewText.indexOf("Semaglutide 2mg"),
    );
    assert.ok(
      previewText.indexOf("Semaglutide 2mg") <
        previewText.indexOf("SEMAGLUTIDE - VIAL"),
    );
    assert.match(previewText, /4\.5 33 beoordelingen/);
    assert.doesNotMatch(previewText, /4\.5\s*·\s*33/);

    await page.goto(`${BASE_URL}/product/retatrutide-20mg-pen`, {
      waitUntil: "networkidle",
    });
    const composition = page
      .getByRole("heading", { name: "Samenstelling" })
      .locator("../..");
    await composition.getByText("Retatrutide pen", { exact: true }).waitFor();
    assert.equal(
      await composition.getByText("Pennaalden", { exact: true }).count(),
      1,
    );
    assert.equal(
      await composition.getByText("Handleiding", { exact: true }).count(),
      1,
    );

    const usage = page
      .getByRole("heading", { name: "Gebruik" })
      .locator("../..");
    await usage
      .getByText("Dosering en gebruiksfrequentie", { exact: true })
      .waitFor();
    await page
      .getByText("Op voorraad - direct leverbaar", { exact: true })
      .waitFor();
    await page
      .locator("#prijzen")
      .getByText("1 – 2 werkdagen", { exact: true })
      .waitFor();
    const shippingLabel = page.locator("strong").filter({
      hasText: /^Verzending:$/,
    });
    assert.equal(await shippingLabel.count(), 1);
  } finally {
    await context.close();
  }
});

test("five-image galleries keep all thumbnails on one mobile row", async () => {
  const { context, page } = await newPage({ width: 390, height: 844 });
  try {
    await page.goto(`${BASE_URL}/product/semaglutide-2mg`, {
      waitUntil: "networkidle",
    });
    const thumbnails = page
      .locator('button[aria-label^="Toon "]')
      .first()
      .locator("..");
    const columns = await thumbnails.evaluate(
      (element) =>
        getComputedStyle(element).gridTemplateColumns.split(" ").length,
    );
    assert.equal(columns, 5);
  } finally {
    await context.close();
  }
});

test("compound hashes filter the catalog without FAQ resetting it", async () => {
  const { context, page } = await newPage();
  try {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page
      .getByRole("link", { name: "Semaglutide", exact: true })
      .first()
      .click();
    await page.waitForTimeout(350);
    assert.equal(await page.locator("#producten article").count(), 2);
    assert.equal(await page.evaluate(() => location.hash), "#semaglutide");

    await page
      .getByRole("link", { name: "Veelgestelde vragen", exact: true })
      .first()
      .click();
    await page.waitForTimeout(350);
    assert.equal(await page.locator("#producten article").count(), 2);
    assert.equal(await page.evaluate(() => location.hash), "#faq");
  } finally {
    await context.close();
  }
});

test("catalog filters use button semantics and expose their active state", async () => {
  const { context, page } = await newPage();
  try {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    const filters = page.getByRole("group", { name: "Filter op stof" });
    const retatrutide = filters.getByRole("button", { name: "Retatrutide" });
    assert.equal(await retatrutide.getAttribute("aria-pressed"), "false");
    await retatrutide.click();
    assert.equal(await retatrutide.getAttribute("aria-pressed"), "true");
  } finally {
    await context.close();
  }
});

test("the announcement marquee is decorative for screen readers", async () => {
  const { context, page } = await newPage();
  try {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    assert.equal(
      await page.locator(".announce-marquee").getAttribute("aria-hidden"),
      "true",
    );
    assert.equal(
      await page
        .getByText(
          "Gratis verzending vanaf €100. Voor 23:00 besteld, volgende werkdag verzonden. Discreet verpakt.",
          { exact: true },
        )
        .count(),
      1,
    );
  } finally {
    await context.close();
  }
});

test("cart quantities and discounts survive a reload", async () => {
  const { context, page } = await newPage();
  try {
    await page.goto(`${BASE_URL}/product/semaglutide-4mg-pen`, {
      waitUntil: "networkidle",
    });
    const increase = page.getByRole("button", { name: "Aantal verhogen" });
    for (let i = 0; i < 4; i += 1) await increase.click();
    await page
      .getByRole("button", { name: /^In winkelwagen/ })
      .first()
      .click();

    await page
      .getByRole("button", { name: "Heb je een kortingscode?" })
      .click();
    await page.getByRole("textbox", { name: "Kortingscode" }).fill("VOLT10");
    await page.getByRole("button", { name: "Toepassen" }).click();
    await page.reload({ waitUntil: "networkidle" });

    const state = await cartState(page);
    assert.deepEqual(state.lines, [
      { slug: "semaglutide-4mg-pen", optionId: "default", qty: 5 },
    ]);
    assert.equal(state.discountApplied, true);
    await page
      .getByRole("button", { name: /Winkelwagen openen, 5 producten/ })
      .first()
      .click();
    const cart = page.getByRole("dialog", { name: "Winkelwagen" });
    await cart
      .getByText("Stapelkorting", { exact: true })
      .waitFor({ state: "visible" });
    await cart
      .getByText("Kortingscode VOLT10", { exact: true })
      .first()
      .waitFor({ state: "visible" });
    await cart.getByText(/76,05/, { exact: false }).waitFor();
    assert.equal(await cart.getByText("Stapelkorting (10%)").count(), 0);
    assert.equal(await cart.getByText("Korting (10%)").count(), 0);
    assert.equal(await cart.getByText("Gratis", { exact: true }).count(), 1);
  } finally {
    await context.close();
  }
});

test("every catalog product route loads its gallery image", async () => {
  const { context, page } = await newPage();
  const slugs = [
    "semaglutide-2mg",
    "semaglutide-4mg-pen",
    "tirzepatide-10mg",
    "tirzepatide-20mg-pen",
    "retatrutide-10mg",
    "retatrutide-20mg-pen",
  ];
  try {
    for (const slug of slugs) {
      const response = await page.goto(`${BASE_URL}/product/${slug}`, {
        waitUntil: "networkidle",
      });
      assert.equal(response?.status(), 200);
      const hero = page.locator("section img").first();
      await hero.waitFor({ state: "visible" });
      assert.ok(
        await hero.evaluate(
          (image) =>
            image instanceof HTMLImageElement &&
            image.complete &&
            image.naturalWidth > 0,
        ),
      );
    }
  } finally {
    await context.close();
  }
});

test("product gallery advances on a horizontal swipe", async () => {
  const { context, page } = await newPage();
  try {
    await page.goto(`${BASE_URL}/product/semaglutide-2mg`, {
      waitUntil: "networkidle",
    });
    await page.getByRole("button", { name: "Begrepen" }).click().catch(() => {});
    const gallery = page.getByRole("region", { name: "Productfoto's" });
    await gallery.waitFor({ state: "visible" });
    const firstDot = page.getByRole("button", { name: "Afbeelding 1" });
    const secondDot = page.getByRole("button", { name: "Afbeelding 2" });
    assert.equal(await firstDot.getAttribute("aria-current"), "true");
    const box = await gallery.boundingBox();
    assert.ok(box);
    await page.mouse.move(box.x + box.width * 0.82, box.y + box.height * 0.45);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.18, box.y + box.height * 0.45, {
      steps: 14,
    });
    await page.mouse.up();
    await page.waitForFunction(
      (selector) =>
        document.querySelector(selector)?.getAttribute("aria-current") ===
        "true",
      'button[aria-label="Afbeelding 2"]',
    );
    assert.equal(await secondDot.getAttribute("aria-current"), "true");
  } finally {
    await context.close();
  }
});

test("unknown product routes return an HTTP 404", async () => {
  const { context, page } = await newPage();
  try {
    const response = await page.goto(`${BASE_URL}/product/bestaat-niet`, {
      waitUntil: "networkidle",
    });
    assert.equal(response?.status(), 404);
    await page.getByRole("heading", { name: "Product niet gevonden" }).waitFor({
      state: "visible",
    });
  } finally {
    await context.close();
  }
});

test("adding to cart does not show a redundant toast over mobile checkout", async () => {
  const { context, page } = await newPage({ width: 390, height: 844 });
  try {
    await page.goto(`${BASE_URL}/product/semaglutide-4mg-pen`, {
      waitUntil: "networkidle",
    });
    await page
      .getByRole("button", { name: /^In winkelwagen/ })
      .first()
      .click();

    const toast = page
      .getByRole("status")
      .filter({ hasText: "Toegevoegd aan winkelwagen" });
    assert.equal(await toast.count(), 0);
    await page.getByRole("link", { name: "Veilig afrekenen" }).waitFor({
      state: "visible",
    });
  } finally {
    await context.close();
  }
});

test("the mobile menu closes with Escape and navigates to a compound", async () => {
  const { context, page } = await newPage({ width: 390, height: 844 });
  try {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    const menu = page.getByRole("button", { name: "Menu openen" });
    await menu.click();
    await page.keyboard.press("Escape");
    assert.equal(await menu.getAttribute("aria-expanded"), "false");

    await menu.click();
    await page
      .getByRole("navigation", { name: "Mobiel menu" })
      .getByRole("link", {
        name: "Tirzepatide",
      })
      .click();
    await page.waitForTimeout(350);
    assert.equal(await page.evaluate(() => location.hash), "#tirzepatide");
    assert.equal(await page.locator("#producten article").count(), 2);
  } finally {
    await context.close();
  }
});

async function fillCheckout(page, email) {
  await page.getByLabel("Naam").fill("Noor de Vries");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Telefoon").fill("0612345678");
  await page.getByLabel("Straat").fill("Teststraat");
  await page.getByLabel("Huisnummer").fill("12 A");
  await page.getByLabel("Postcode").fill("1234 AB");
  await page.getByLabel("Plaats").fill("Utrecht");
  await page.getByLabel("Land").selectOption("NL");
  await page.getByLabel(/Opmerking/).fill("Browserregressie voor de checkout.");
}

async function addPenAndOpenCheckout(page) {
  await page.goto(`${BASE_URL}/product/semaglutide-4mg-pen`, {
    waitUntil: "networkidle",
  });
  await page
    .getByRole("button", { name: /^In winkelwagen/ })
    .first()
    .click();
  await page.getByRole("link", { name: "Veilig afrekenen" }).click();
  await page.waitForURL(`${BASE_URL}/checkout`);
}

async function waitForCheckoutSubmit(page) {
  const button = page.getByRole("button", { name: "Bestelling plaatsen" });
  await button.waitFor({ state: "visible" });
  await button.evaluate((element) => {
    if (!(element instanceof HTMLButtonElement) || !element.disabled) return;
    return new Promise((resolve, reject) => {
      let observer;
      const timeout = setTimeout(() => {
        observer?.disconnect();
        reject(
          new Error(
            "Checkout-submit bleef langer dan 15 seconden uitgeschakeld.",
          ),
        );
      }, 15_000);
      observer = new MutationObserver(() => {
        if (!element.disabled) {
          observer.disconnect();
          clearTimeout(timeout);
          resolve(undefined);
        }
      });
      observer.observe(element, {
        attributes: true,
        attributeFilter: ["disabled"],
      });
      if (!element.disabled) {
        observer.disconnect();
        clearTimeout(timeout);
        resolve(undefined);
      }
    });
  });
  return button;
}

test("direct checkout navigation and hard reload hydrate a persisted cart", async () => {
  const { context, page } = await newPage();
  try {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.evaluate(() => {
      localStorage.setItem(
        "volt-cart",
        JSON.stringify({
          state: {
            lines: [
              {
                slug: "semaglutide-4mg-pen",
                optionId: "default",
                qty: 1,
              },
            ],
            discountCode: "",
            discountApplied: false,
            selectedSlug: "semaglutide-4mg-pen",
            selectedOptionId: "default",
          },
          version: 0,
        }),
      );
    });

    await page.goto(`${BASE_URL}/checkout`, { waitUntil: "networkidle" });
    await page
      .getByRole("heading", { name: "Waar mogen we bezorgen?" })
      .waitFor();
    await page.reload({ waitUntil: "networkidle" });
    await page
      .getByRole("heading", { name: "Waar mogen we bezorgen?" })
      .waitFor();
    await page.getByText("Semaglutide 4mg - Pen", { exact: true }).waitFor();
    assert.equal(
      await page.getByText(/Switched to client rendering/).count(),
      0,
    );
  } finally {
    await context.close();
  }
});

test("a product can be ordered and only its authorized guest sees confirmation", async () => {
  const { context, page } = await newPage();
  try {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: BASE_URL,
    });
    await page.goto(`${BASE_URL}/product/semaglutide-4mg-pen`, {
      waitUntil: "networkidle",
    });
    await page
      .getByRole("button", { name: /^In winkelwagen/ })
      .first()
      .click();
    await page.getByRole("link", { name: "Veilig afrekenen" }).click();
    await page.waitForURL(`${BASE_URL}/checkout`);
    await fillCheckout(page, `checkout-${randomUUID()}@example.test`);
    const placeOrder = page.getByRole("button", {
      name: "Bestelling plaatsen",
    });
    await placeOrder.waitFor({ state: "visible" });
    await assert.doesNotReject(async () => {
      await placeOrder.click();
      await page.waitForURL(/\/bestelling\/[^/]+$/, { timeout: 15_000 });
    });

    const orderNumberHeading = page.getByRole("heading", {
      level: 1,
      name: /^VOLT-[A-Z0-9]{8}$/,
    });
    await orderNumberHeading.waitFor();
    const orderNumber = (await orderNumberHeading.innerText()).trim();
    assert.match(orderNumber, /^VOLT-[A-Z0-9]{8}$/);
    await page
      .getByRole("heading", { name: "Bewaar je herstelcode" })
      .waitFor();
    const recoveryCode = (await page.locator("code").innerText()).trim();
    await page.getByRole("button", { name: "Kopieer" }).click();
    await page.getByRole("button", { name: "Gekopieerd" }).waitFor();
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      recoveryCode,
    );

    const clipboardPageErrors = [];
    const captureClipboardPageError = (error) => {
      clipboardPageErrors.push(error.message);
    };
    page.on("pageerror", captureClipboardPageError);
    await page.evaluate(() => {
      Object.defineProperty(navigator.clipboard, "writeText", {
        configurable: true,
        value: () =>
          new Promise((_, reject) => {
            setTimeout(
              () => reject(new DOMException("Geweigerd", "NotAllowedError")),
              100,
            );
          }),
      });
    });
    await page.getByRole("button", { name: "Gekopieerd" }).click();
    const copyingButton = page.getByRole("button", { name: "Kopiëren…" });
    await copyingButton.waitFor();
    assert.equal(await copyingButton.isDisabled(), true);
    await page.getByRole("button", { name: "Opnieuw kopiëren" }).waitFor();
    await page
      .getByRole("alert")
      .getByText(
        "Kopiëren is niet gelukt. Selecteer de code en kopieer deze handmatig.",
        { exact: true },
      )
      .waitFor();
    await page.waitForTimeout(0);
    assert.deepEqual(clipboardPageErrors, []);
    page.off("pageerror", captureClipboardPageError);
    assert.deepEqual((await cartState(page)).lines, []);
    assert.deepEqual(
      await page.evaluate(() =>
        Object.keys(sessionStorage).filter((key) =>
          key.startsWith("volt-order-recovery:"),
        ),
      ),
      [],
    );
    const storedBrowserState = await page.evaluate(() =>
      JSON.stringify({
        local: Object.entries(localStorage),
        session: Object.entries(sessionStorage),
      }),
    );
    assert.equal(storedBrowserState.includes(recoveryCode), false);
    const guestCookie = (await context.cookies()).find(
      (cookie) => cookie.name === "__Host-volt-order-access",
    );
    assert.ok(guestCookie);
    assert.equal(guestCookie.secure, true);
    assert.equal(guestCookie.path, "/");
    assert.equal(guestCookie.sameSite, "Strict");

    const orderUrl = page.url();
    let serverRenderedWithoutViewer = "";
    const stripViewerFromDocumentRequest = async (route) => {
      const request = route.request();
      if (request.resourceType() !== "document") {
        await route.continue();
        return;
      }
      const headers = { ...request.headers() };
      delete headers.cookie;
      const response = await route.fetch({ headers });
      serverRenderedWithoutViewer = await response.text();
      await route.fulfill({ response, body: serverRenderedWithoutViewer });
    };
    await page.route("**/*", stripViewerFromDocumentRequest);
    try {
      await page.reload({ waitUntil: "networkidle" });
      assert.match(serverRenderedWithoutViewer, /Bestelling laden/);
      assert.equal(serverRenderedWithoutViewer.includes(orderNumber), false);
      await page
        .getByRole("heading", { level: 1, name: orderNumber })
        .waitFor();
    } finally {
      await page
        .unroute("**/*", stripViewerFromDocumentRequest)
        .catch(() => {});
    }

    const denied = await newPage();
    try {
      await denied.page.goto(orderUrl, { waitUntil: "networkidle" });
      await denied.page
        .getByRole("heading", { name: "Bestelling niet beschikbaar" })
        .waitFor();
      assert.equal(
        await denied.page.getByText(orderNumber, { exact: true }).count(),
        0,
      );

      await denied.page.goto(`${BASE_URL}/account`, {
        waitUntil: "networkidle",
      });
      await denied.page.getByLabel("Bestelnummer").fill(orderNumber);
      await denied.page.getByLabel("Herstelcode").fill(recoveryCode);
      await denied.page
        .getByRole("button", { name: "Bestelling bekijken" })
        .click();
      await denied.page.waitForURL(/\/bestelling\/[^/]+$/);
      await denied.page.getByRole("heading", { name: orderNumber }).waitFor();
    } finally {
      await denied.context.close();
    }
    await verifyAdminNextOrderStatuses(context, page, orderNumber);
  } finally {
    await context.close();
  }
});

test("order confirmation never carries a recovery code to another order", async () => {
  const { context, page } = await newPage();
  try {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    const [firstOrder, secondOrder] = await page.evaluate(async () => {
      const { createOrder } = await import("/src/lib/server/orders.ts");
      const createTestOrder = (label) =>
        createOrder({
          data: {
            name: `Routewissel ${label}`,
            email: `routewissel-${label}-${crypto.randomUUID()}@example.test`,
            phone: "0612345678",
            street: "Teststraat",
            houseNumber: "12",
            postcode: "1234 AB",
            city: "Utrecht",
            country: "NL",
            note: "Herstelcode mag niet naar een andere bestelling lekken.",
            lines: [{ slug: "semaglutide-2mg", optionId: "none", qty: 1 }],
            idempotencyKey: crypto.randomUUID(),
          },
        });
      return Promise.all([createTestOrder("a"), createTestOrder("b")]);
    });

    await page.goto(`${BASE_URL}/admin`, { waitUntil: "networkidle" });
    await page.getByLabel("Beheerwachtwoord").fill(TEST_ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Inloggen" }).click();
    await page.getByRole("heading", { name: "Shopbeheer" }).waitFor();

    const stagedCode = "ALLEEN-VOOR-BESTELLING-A";
    await page.evaluate(
      async ({ orderId, code }) => {
        const { stageOrderRecoveryCode } =
          await import("/src/lib/order-recovery-memory.ts");
        stageOrderRecoveryCode(orderId, code);
        await window.__TSR_ROUTER__.navigate({
          to: "/bestelling/$id",
          params: { id: orderId },
        });
      },
      { orderId: firstOrder.order.id, code: stagedCode },
    );
    await page
      .getByRole("heading", { name: firstOrder.order.orderNumber })
      .waitFor();
    await page.getByText(stagedCode, { exact: true }).waitFor();

    await page.evaluate(async (orderId) => {
      await window.__TSR_ROUTER__.navigate({
        to: "/bestelling/$id",
        params: { id: orderId },
      });
    }, secondOrder.order.id);
    await page
      .getByRole("heading", { name: secondOrder.order.orderNumber })
      .waitFor();
    assert.equal(await page.getByText(stagedCode, { exact: true }).count(), 0);

    await page.evaluate(async (orderId) => {
      await window.__TSR_ROUTER__.navigate({
        to: "/bestelling/$id",
        params: { id: orderId },
      });
    }, firstOrder.order.id);
    await page
      .getByRole("heading", { name: firstOrder.order.orderNumber })
      .waitFor();
    assert.equal(await page.getByText(stagedCode, { exact: true }).count(), 0);
  } finally {
    await context.close();
  }
});

test("a checkout request failure keeps the cart intact", async () => {
  const { context, page } = await newPage();
  try {
    await page.goto(`${BASE_URL}/product/semaglutide-4mg-pen`, {
      waitUntil: "networkidle",
    });
    await page
      .getByRole("button", { name: /^In winkelwagen/ })
      .first()
      .click();
    await page.getByRole("link", { name: "Veilig afrekenen" }).click();
    await page.waitForURL(`${BASE_URL}/checkout`);
    await fillCheckout(page, `mislukt-${randomUUID()}@example.test`);
    const placeOrder = page.getByRole("button", {
      name: "Bestelling plaatsen",
    });
    await placeOrder.waitFor({ state: "visible" });

    await page.route("**/*", async (route) => {
      if (route.request().method() === "POST") {
        await route.abort();
      } else {
        await route.continue();
      }
    });
    await placeOrder.click();
    await page.getByText(/Je winkelwagen is bewaard/).waitFor();
    assert.equal((await cartState(page)).lines.length, 1);
  } finally {
    await context.close();
  }
});

test("an ambiguous checkout response conflicts on changes and replays the exact order", async () => {
  const created = await newPage();
  const { context } = created;
  let { page } = created;
  const checkoutEmail = `ambigu-${randomUUID()}@example.test`;
  let droppedOrderResponse = false;
  let committedStatus;
  let committedKey;
  let resolveCommittedStatus;
  const committedStatusReady = new Promise((resolve) => {
    resolveCommittedStatus = resolve;
  });
  const dropCommittedResponse = async (route) => {
    const request = route.request();
    const body = request.postData() ?? "";
    if (
      !droppedOrderResponse &&
      request.method() === "POST" &&
      /checkout-v2-[a-f0-9]{64}/.test(body)
    ) {
      committedKey = body.match(/checkout-v2-[a-f0-9]{64}/)?.[0];
      const response = await route.fetch();
      committedStatus = response.status();
      droppedOrderResponse = true;
      resolveCommittedStatus(committedStatus);
      if (committedStatus === 200) {
        await route.abort("failed");
      } else {
        await route.fulfill({ response });
      }
      return;
    }
    await route.continue();
  };

  try {
    await context.addInitScript(() => {
      const offsetKey = "volt-test-checkout-clock-offset";
      const nativeNow = Date.now.bind(Date);
      Date.now = () =>
        nativeNow() + Number(localStorage.getItem(offsetKey) ?? "0");
      globalThis.__setCheckoutClockHours = (hours) => {
        localStorage.setItem(offsetKey, String(hours * 60 * 60 * 1_000));
      };
    });
    await addPenAndOpenCheckout(page);
    await fillCheckout(page, checkoutEmail);
    const placeOrder = await waitForCheckoutSubmit(page);
    const initialStoredAttempt = await page.evaluate(async () => {
      const { CHECKOUT_ATTEMPT_STORAGE_KEY } =
        await import("/src/lib/checkout-idempotency.ts");
      return localStorage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
    });
    assert.ok(initialStoredAttempt);
    await page.evaluate(() => globalThis.__setCheckoutClockHours(71));
    await page.route("**/*", dropCommittedResponse);
    await placeOrder.click();
    assert.equal(
      await within(
        committedStatusReady,
        10_000,
        "De eerste checkoutresponse bleef uit.",
      ),
      200,
      "De ambiguïteitstest ontving onverwacht een andere serverstatus (bijvoorbeeld 429).",
    );
    await page.getByText(/Je winkelwagen is bewaard/).waitFor();
    await page.unroute("**/*", dropCommittedResponse);

    assert.equal(droppedOrderResponse, true);
    assert.equal(committedStatus, 200);
    assert.equal((await cartState(page)).lines.length, 1);
    const storedAttempt = await page.evaluate(async () => {
      const { CHECKOUT_ATTEMPT_STORAGE_KEY } =
        await import("/src/lib/checkout-idempotency.ts");
      return localStorage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
    });
    assert.ok(storedAttempt);
    assert.deepEqual(Object.keys(JSON.parse(storedAttempt)).sort(), [
      "expiresAt",
      "seed",
      "version",
    ]);
    assert.equal(
      JSON.parse(storedAttempt).seed,
      JSON.parse(initialStoredAttempt).seed,
    );
    assert.ok(
      JSON.parse(storedAttempt).expiresAt >=
        JSON.parse(initialStoredAttempt).expiresAt + 70 * 60 * 60 * 1_000,
    );
    assert.doesNotMatch(
      storedAttempt,
      new RegExp(
        [
          "Noor",
          checkoutEmail,
          "0612345678",
          "Teststraat",
          "1234 AB",
          "Browserregressie",
        ].join("|"),
        "i",
      ),
    );

    await page.evaluate(() => globalThis.__setCheckoutClockHours(73));
    await page.close();
    page = await context.newPage();
    await page.goto(`${BASE_URL}/checkout`, { waitUntil: "networkidle" });
    await fillCheckout(page, checkoutEmail);
    await page.getByLabel("Straat").fill("Gewijzigde straat");
    const retryButton = await waitForCheckoutSubmit(page);
    assert.equal(
      await page.evaluate(async () => {
        const { CHECKOUT_ATTEMPT_STORAGE_KEY } =
          await import("/src/lib/checkout-idempotency.ts");
        return localStorage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
      }),
      storedAttempt,
    );
    const conflictResponse = page.waitForResponse(
      (response) => response.status() === 409,
    );
    await retryButton.click();
    const conflict = await conflictResponse;
    const retryKey = (conflict.request().postData() ?? "").match(
      /checkout-v2-[a-f0-9]{64}/,
    )?.[0];
    assert.equal(retryKey, committedKey);
    await page
      .getByRole("alert")
      .getByText(/Zet de oorspronkelijke gegevens terug en probeer opnieuw/)
      .waitFor();
    assert.equal(
      await page
        .getByRole("alert")
        .getByRole("link", { name: "Bekijk je bestellingen." })
        .count(),
      0,
    );
    const attemptAfterConflict = await page.evaluate(async () => {
      const { CHECKOUT_ATTEMPT_STORAGE_KEY } =
        await import("/src/lib/checkout-idempotency.ts");
      return localStorage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
    });
    assert.equal(
      JSON.parse(attemptAfterConflict).seed,
      JSON.parse(storedAttempt).seed,
    );
    assert.ok(
      JSON.parse(attemptAfterConflict).expiresAt >
        JSON.parse(storedAttempt).expiresAt,
    );

    await page.getByLabel("Straat").fill("Teststraat");
    const replayResponse = page.waitForResponse((response) => {
      const body = response.request().postData() ?? "";
      return response.status() === 200 && body.includes(committedKey);
    });
    await retryButton.click();
    const replay = await replayResponse;
    assert.equal(
      (replay.request().postData() ?? "").match(
        /checkout-v2-[a-f0-9]{64}/,
      )?.[0],
      committedKey,
    );
    await page.waitForURL(/\/bestelling\/[^/]+$/, { timeout: 15_000 });
    const replayedOrderId = decodeURIComponent(
      new URL(page.url()).pathname.split("/").at(-1),
    );
    const replayedOrderNumberHeading = page.getByRole("heading", {
      level: 1,
      name: /^VOLT-[A-Z0-9]{8}$/,
    });
    await replayedOrderNumberHeading.waitFor();
    const replayedOrderNumber = (
      await replayedOrderNumberHeading.innerText()
    ).trim();
    await page
      .getByRole("heading", { name: "Bewaar je herstelcode" })
      .waitFor();
    assert.ok((await page.locator("code").innerText()).trim().length >= 8);
    assert.equal(
      await page.evaluate(async () => {
        const { CHECKOUT_ATTEMPT_STORAGE_KEY } =
          await import("/src/lib/checkout-idempotency.ts");
        return localStorage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
      }),
      null,
    );

    await page.goto(`${BASE_URL}/admin`, { waitUntil: "networkidle" });
    await page.getByLabel("Beheerwachtwoord").fill(TEST_ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Inloggen" }).click();
    await page.getByRole("heading", { name: "Shopbeheer" }).waitFor();
    const matchingOrders = await page.evaluate(async (email) => {
      const { listOrders } = await import("/src/lib/server/orders.ts");
      return listOrders({
        data: { search: email, status: "all", page: 1, pageSize: 20 },
      });
    }, checkoutEmail);
    assert.equal(matchingOrders.total, 1);
    assert.equal(matchingOrders.orders[0]?.id, replayedOrderId);
    assert.equal(matchingOrders.orders[0]?.orderNumber, replayedOrderNumber);
  } finally {
    await page.unroute("**/*", dropCommittedResponse).catch(() => {});
    await context.close();
  }
});

test("a 410 replay expiry becomes terminal without rotating or extending the attempt", async () => {
  const { context, page } = await newPage();
  const checkoutEmail = `expired-${randomUUID()}@example.test`;
  const observedKeys = [];
  let droppedCommittedResponse = false;
  let resolveCommittedStatus;
  const committedStatusReady = new Promise((resolve) => {
    resolveCommittedStatus = resolve;
  });
  const handleOrderResponses = async (route) => {
    const request = route.request();
    const requestBody = request.postData() ?? "";
    const key = requestBody.match(/checkout-v2-[a-f0-9]{64}/)?.[0];
    if (request.method() !== "POST" || !key) {
      await route.continue();
      return;
    }
    observedKeys.push(key);
    if (!droppedCommittedResponse) {
      const response = await route.fetch();
      const status = response.status();
      droppedCommittedResponse = true;
      resolveCommittedStatus(status);
      if (status === 200) {
        await route.abort("failed");
      } else {
        await route.fulfill({ response });
      }
      return;
    }

    const conflictResponse = await route.fetch();
    assert.equal(conflictResponse.status(), 409);
    const conflictBody = await conflictResponse.text();
    const replayExpiredBody = conflictBody.replaceAll(
      "Deze bestelling is al geplaatst.",
      "De tijdelijke toegang tot deze bestelling is verlopen.",
    );
    assert.notEqual(replayExpiredBody, conflictBody);
    await route.fulfill({
      response: conflictResponse,
      status: 410,
      body: replayExpiredBody,
    });
  };

  try {
    await context.addInitScript(() => {
      const offsetKey = "volt-test-checkout-clock-offset";
      const nativeNow = Date.now.bind(Date);
      Date.now = () =>
        nativeNow() + Number(localStorage.getItem(offsetKey) ?? "0");
      globalThis.__setCheckoutClockHours = (hours) => {
        localStorage.setItem(offsetKey, String(hours * 60 * 60 * 1_000));
      };
    });
    await addPenAndOpenCheckout(page);
    await fillCheckout(page, checkoutEmail);
    const placeOrder = await waitForCheckoutSubmit(page);
    await page.route("**/*", handleOrderResponses);

    await placeOrder.click();
    assert.equal(
      await within(
        committedStatusReady,
        10_000,
        "De eerste checkoutresponse bleef uit.",
      ),
      200,
      "De 410-test ontving onverwacht een andere initiële serverstatus (bijvoorbeeld 429).",
    );
    await page.getByText(/Je winkelwagen is bewaard/).waitFor();
    assert.equal(observedKeys.length, 1);
    const committedKey = observedKeys[0];
    await page.evaluate(() => globalThis.__setCheckoutClockHours(73));
    const attemptBefore410 = await page.evaluate(async () => {
      const { CHECKOUT_ATTEMPT_STORAGE_KEY } =
        await import("/src/lib/checkout-idempotency.ts");
      return localStorage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
    });
    assert.ok(attemptBefore410);

    await page.getByLabel("Straat").fill("Gewijzigde straat");
    const expiredResponse = page.waitForResponse(
      (response) => response.status() === 410,
    );
    await placeOrder.click();
    await expiredResponse;
    await page
      .getByRole("alert")
      .getByText(/Plaats de bestelling niet opnieuw.*via Contact/i)
      .waitFor();
    assert.deepEqual(observedKeys, [committedKey, committedKey]);
    assert.equal(
      await page.evaluate(async () => {
        const { CHECKOUT_ATTEMPT_STORAGE_KEY } =
          await import("/src/lib/checkout-idempotency.ts");
        return localStorage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
      }),
      attemptBefore410,
    );
    const marker = (await context.cookies()).find(
      (cookie) => cookie.name === "volt-checkout-attempt-marker-local-v1",
    );
    assert.match(marker?.value ?? "", /^replay-expired\.[a-f0-9]{64}$/);

    await page
      .locator("form")
      .evaluate((form) =>
        (form instanceof HTMLFormElement ? form : null)?.requestSubmit(),
      );
    await page.waitForTimeout(250);
    assert.equal(observedKeys.length, 2);

    await page.reload({ waitUntil: "networkidle" });
    await fillCheckout(page, checkoutEmail);
    const reloadedSubmit = await waitForCheckoutSubmit(page);
    await reloadedSubmit.click();
    await page
      .getByRole("alert")
      .getByText(/Plaats de bestelling niet opnieuw.*via Contact/i)
      .waitFor();
    assert.equal(observedKeys.length, 2);
    assert.equal(
      await page.evaluate(async () => {
        const { CHECKOUT_ATTEMPT_STORAGE_KEY } =
          await import("/src/lib/checkout-idempotency.ts");
        return localStorage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
      }),
      attemptBefore410,
    );
  } finally {
    await page.unroute("**/*", handleOrderResponses).catch(() => {});
    await context.close();
  }
});

test("an older checkout tab cannot overwrite a seed rotated after success", async () => {
  const { context, page: olderTab } = await newPage();
  const checkoutEmail = `tabs-${randomUUID()}@example.test`;
  let newerTab;
  const observedKeys = [];
  const captureOrderRequest = (request) => {
    const key = (request.postData() ?? "").match(
      /checkout-v2-[a-f0-9]{64}/,
    )?.[0];
    if (request.method() === "POST" && key) observedKeys.push(key);
  };

  try {
    await addPenAndOpenCheckout(olderTab);
    await fillCheckout(olderTab, checkoutEmail);
    await waitForCheckoutSubmit(olderTab);
    const originalAttempt = await olderTab.evaluate(async () => {
      const { CHECKOUT_ATTEMPT_STORAGE_KEY } =
        await import("/src/lib/checkout-idempotency.ts");
      return localStorage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
    });
    assert.ok(originalAttempt);

    newerTab = await context.newPage();
    await newerTab.goto(`${BASE_URL}/checkout`, { waitUntil: "networkidle" });
    await fillCheckout(newerTab, checkoutEmail);
    const newerSubmit = await waitForCheckoutSubmit(newerTab);
    await newerTab.evaluate(async () => {
      const { CHECKOUT_ATTEMPT_STORAGE_KEY } =
        await import("/src/lib/checkout-idempotency.ts");
      const nativeRemoveItem = Storage.prototype.removeItem;
      Storage.prototype.removeItem = function (key) {
        if (key === CHECKOUT_ATTEMPT_STORAGE_KEY) return;
        return nativeRemoveItem.call(this, key);
      };
    });
    context.on("request", captureOrderRequest);

    await newerSubmit.click();
    await newerTab.waitForURL(/\/bestelling\/[^/]+$/, { timeout: 15_000 });
    const originalSeed = JSON.parse(originalAttempt).seed;
    const rotatedAttempt = await newerTab.evaluate(async (seed) => {
      const { CHECKOUT_ATTEMPT_STORAGE_KEY } =
        await import("/src/lib/checkout-idempotency.ts");
      const deadline = performance.now() + 10_000;
      while (performance.now() < deadline) {
        const raw = localStorage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
        if (raw && JSON.parse(raw).seed !== seed) return raw;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error("De duurzame checkoutseed werd niet tijdig geroteerd.");
    }, originalSeed);
    assert.ok(rotatedAttempt);
    assert.notEqual(JSON.parse(rotatedAttempt).seed, originalSeed);
    assert.equal(observedKeys.length, 1);

    await olderTab
      .locator("form")
      .evaluate((form) =>
        (form instanceof HTMLFormElement ? form : null)?.requestSubmit(),
      );
    await olderTab
      .getByRole("alert")
      .getByText(/al geplaatst.*niet opnieuw worden verstuurd/)
      .waitFor({ timeout: 10_000 });
    assert.equal(observedKeys.length, 1);
    assert.equal(
      await olderTab.evaluate(async () => {
        const { CHECKOUT_ATTEMPT_STORAGE_KEY } =
          await import("/src/lib/checkout-idempotency.ts");
        return localStorage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
      }),
      rotatedAttempt,
    );

    await newerTab.goto(`${BASE_URL}/admin`, { waitUntil: "networkidle" });
    await newerTab.getByLabel("Beheerwachtwoord").fill(TEST_ADMIN_PASSWORD);
    await newerTab.getByRole("button", { name: "Inloggen" }).click();
    await newerTab.getByRole("heading", { name: "Shopbeheer" }).waitFor();
    const matchingOrders = await newerTab.evaluate(async (email) => {
      const { listOrders } = await import("/src/lib/server/orders.ts");
      return listOrders({
        data: { search: email, status: "all", page: 1, pageSize: 20 },
      });
    }, checkoutEmail);
    assert.equal(matchingOrders.total, 1);
  } finally {
    context.off("request", captureOrderRequest);
    await context.close();
  }
});

test("checkout blocks when retry protection cannot be written or read back", async () => {
  for (const failingMethod of ["setItem", "getItem"]) {
    const { context, page } = await newPage();
    let orderRequests = 0;
    const countOrderRequests = (request) => {
      if (
        request.method() === "POST" &&
        /checkout-v2-[a-f0-9]{64}/.test(request.postData() ?? "")
      ) {
        orderRequests += 1;
      }
    };
    try {
      await addPenAndOpenCheckout(page);
      await fillCheckout(
        page,
        `opslag-${failingMethod}-${randomUUID()}@example.test`,
      );
      const placeOrder = await waitForCheckoutSubmit(page);
      await page.evaluate(async (method) => {
        const { CHECKOUT_ATTEMPT_STORAGE_KEY } =
          await import("/src/lib/checkout-idempotency.ts");
        const nativeMethod = Storage.prototype[method];
        Storage.prototype[method] = function (key, ...values) {
          if (key === CHECKOUT_ATTEMPT_STORAGE_KEY) {
            throw new DOMException("Opslag geweigerd", "QuotaExceededError");
          }
          return nativeMethod.call(this, key, ...values);
        };
      }, failingMethod);
      page.on("request", countOrderRequests);

      await placeOrder.click();
      await page
        .getByRole("alert")
        .getByText(
          "De veilige herhaalbeveiliging kon niet worden opgeslagen. Sta browseropslag toe en probeer opnieuw.",
          { exact: true },
        )
        .waitFor();
      assert.equal(orderRequests, 0, failingMethod);
      assert.equal((await cartState(page)).lines.length, 1, failingMethod);
    } finally {
      page.off("request", countOrderRequests);
      await context.close();
    }
  }
});

test("checkout fails closed without Web Locks and while its storage lock is occupied", async () => {
  for (const scenario of ["missing", "occupied"]) {
    const { context, page } = await newPage();
    let orderRequests = 0;
    const countOrderRequests = (request) => {
      if (
        request.method() === "POST" &&
        /checkout-v2-[a-f0-9]{64}/.test(request.postData() ?? "")
      ) {
        orderRequests += 1;
      }
    };
    try {
      if (scenario === "missing") {
        await page.addInitScript(() => {
          Object.defineProperty(Navigator.prototype, "locks", {
            configurable: true,
            get: () => undefined,
          });
        });
      }
      await addPenAndOpenCheckout(page);
      await fillCheckout(
        page,
        `locks-${scenario}-${randomUUID()}@example.test`,
      );
      const placeOrder = await waitForCheckoutSubmit(page);
      if (scenario === "occupied") {
        await page.evaluate(async () => {
          const { CHECKOUT_STORAGE_LOCK_NAME } =
            await import("/src/lib/checkout-idempotency.ts");
          await new Promise((resolve) => {
            void navigator.locks.request(
              CHECKOUT_STORAGE_LOCK_NAME,
              async () => {
                globalThis.__voltCheckoutLockHeld = true;
                resolve(undefined);
                await new Promise((release) => {
                  globalThis.__releaseVoltCheckoutLock = release;
                });
              },
            );
          });
        });
      }
      page.on("request", countOrderRequests);

      await placeOrder.click();
      await page
        .getByRole("alert")
        .getByText(/veilige tabbladbeveiliging is niet beschikbaar of bezet/i)
        .waitFor({ timeout: 8_000 });
      assert.equal(orderRequests, 0, scenario);
      assert.equal((await cartState(page)).lines.length, 1, scenario);
    } finally {
      page.off("request", countOrderRequests);
      if (scenario === "occupied") {
        await page
          .evaluate(() => globalThis.__releaseVoltCheckoutLock?.())
          .catch(() => {});
      }
      await context.close();
    }
  }
});

test("a contended success finalizer never withholds order recovery", async () => {
  const { context, page } = await newPage();
  const reloadProbe = await context.newPage();
  let heldDuringFinalization = false;
  let committedKey;
  let markCommittedResponseReleased;
  const committedResponseReleased = new Promise((resolve) => {
    markCommittedResponseReleased = resolve;
  });
  const holdLockAfterCommit = async (route) => {
    const request = route.request();
    const requestBody = request.postData() ?? "";
    if (
      request.method() !== "POST" ||
      !/checkout-v2-[a-f0-9]{64}/.test(requestBody)
    ) {
      await route.continue();
      return;
    }
    committedKey = requestBody.match(/checkout-v2-[a-f0-9]{64}/)?.[0];
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    await route.fulfill({ response });
    markCommittedResponseReleased(undefined);
  };

  try {
    await reloadProbe.goto(BASE_URL, { waitUntil: "networkidle" });
    await addPenAndOpenCheckout(page);
    await fillCheckout(page, `lock-success-${randomUUID()}@example.test`);
    const placeOrder = await waitForCheckoutSubmit(page);
    await page.evaluate(async () => {
      const { COMPLETED_CART_EPOCH_STORAGE_KEY } =
        await import("/src/lib/cart-lifecycle.ts");
      const { CHECKOUT_STORAGE_LOCK_NAME } =
        await import("/src/lib/checkout-idempotency.ts");
      const storagePrototype = Storage.prototype;
      const nativeSetItem = storagePrototype.setItem;
      globalThis.__voltNativeStorageSetItem = nativeSetItem;
      storagePrototype.setItem = function (key, value) {
        const result = nativeSetItem.call(this, key, value);
        if (
          this === localStorage &&
          key === COMPLETED_CART_EPOCH_STORAGE_KEY &&
          !globalThis.__voltCheckoutFinalizerLockQueued
        ) {
          globalThis.__voltCheckoutFinalizerLockQueued = true;
          void navigator.locks.request(CHECKOUT_STORAGE_LOCK_NAME, async () => {
            globalThis.__voltCheckoutLockHeld = true;
            await new Promise((release) => {
              globalThis.__releaseVoltCheckoutLock = release;
            });
          });
        }
        return result;
      };
    });
    await page.route("**/*", holdLockAfterCommit);
    await placeOrder.click();
    await within(
      committedResponseReleased,
      10_000,
      "De bevestigde checkoutresponse bleef uit.",
    );
    await page.waitForFunction(() => {
      const cart = JSON.parse(localStorage.getItem("volt-cart") || "{}");
      return Array.isArray(cart.state?.lines) && cart.state.lines.length === 0;
    });
    await page.waitForFunction(
      () => globalThis.__voltCheckoutLockHeld === true,
    );
    heldDuringFinalization = await page.evaluate(
      () => globalThis.__voltCheckoutLockHeld === true,
    );
    assert.equal(heldDuringFinalization, true);
    assert.match(new URL(page.url()).pathname, /^\/bestelling\/[^/]+$/);
    await page
      .getByRole("heading", { name: "Bewaar je herstelcode" })
      .waitFor();
    assert.deepEqual((await cartState(page)).lines, []);

    const durableAttempt = await page.evaluate(async () => {
      const { CHECKOUT_ATTEMPT_STORAGE_KEY } =
        await import("/src/lib/checkout-idempotency.ts");
      return localStorage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
    });
    assert.ok(durableAttempt);
    assert.equal(
      await reloadProbe.evaluate(async () => {
        const { CHECKOUT_ATTEMPT_STORAGE_KEY, checkoutIdempotencyKeyFromSeed } =
          await import("/src/lib/checkout-idempotency.ts");
        const stored = JSON.parse(
          localStorage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY),
        );
        return checkoutIdempotencyKeyFromSeed(stored.seed);
      }),
      committedKey,
    );
    // A hard reload in the same browser session sees the already-persisted
    // empty cart and the still-durable original attempt. It therefore cannot
    // invent a new key during the finalizer crash window.
    await reloadProbe.reload({ waitUntil: "networkidle" });
    assert.equal(new URL(reloadProbe.url()).pathname, "/");
    assert.deepEqual((await cartState(reloadProbe)).lines, []);

    const releasedAt = Date.now();
    await page.evaluate(() => globalThis.__releaseVoltCheckoutLock?.());
    await page.waitForURL(/\/bestelling\/[^/]+$/, { timeout: 15_000 });
    assert.ok(Date.now() - releasedAt < 2_000);
    await page
      .getByRole("heading", { name: "Bewaar je herstelcode" })
      .waitFor();
    assert.equal(
      await page.evaluate(async () => {
        const { CHECKOUT_ATTEMPT_STORAGE_KEY } =
          await import("/src/lib/checkout-idempotency.ts");
        return localStorage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
      }),
      null,
    );
  } finally {
    await page.unroute("**/*", holdLockAfterCommit).catch(() => {});
    await page
      .evaluate(() => {
        globalThis.__releaseVoltCheckoutLock?.();
        if (globalThis.__voltNativeStorageSetItem) {
          Storage.prototype.setItem = globalThis.__voltNativeStorageSetItem;
        }
      })
      .catch(() => {});
    await context.close();
  }
});

test("a cart persistence failure after commit cannot submit the order twice", async () => {
  const { context, page } = await newPage();
  const observedKeys = [];
  const failCartPersistenceAfterCommit = async (route) => {
    const request = route.request();
    const key = (request.postData() ?? "").match(
      /checkout-v2-[a-f0-9]{64}/,
    )?.[0];
    if (request.method() !== "POST" || !key) {
      await route.continue();
      return;
    }
    observedKeys.push(key);
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    await page.evaluate(() => {
      globalThis.__voltFailCartPersistence = true;
    });
    const responseBody = await response.text();
    await route.fulfill({
      response,
      body: responseBody,
    });
  };

  try {
    await addPenAndOpenCheckout(page);
    await fillCheckout(page, `cart-write-${randomUUID()}@example.test`);
    await page.evaluate(() => {
      const nativeSetItem = Storage.prototype.setItem;
      globalThis.__voltFailCartPersistence = false;
      Storage.prototype.setItem = function (key, value) {
        if (key === "volt-cart" && globalThis.__voltFailCartPersistence) {
          throw new DOMException("Cartopslag geweigerd", "SecurityError");
        }
        return nativeSetItem.call(this, key, value);
      };
    });
    await page.route("**/*", failCartPersistenceAfterCommit);

    const placeOrder = await waitForCheckoutSubmit(page);
    await placeOrder.click();
    await page.waitForURL(/\/bestelling\/[^/]+$/, { timeout: 15_000 });
    await page
      .getByRole("heading", { name: "Bewaar je herstelcode" })
      .waitFor();
    assert.equal(observedKeys.length, 1);
    assert.equal(
      await page.getByText(/Bestelling plaatsen is niet gelukt/).count(),
      0,
    );
    assert.equal((await cartState(page)).lines.length, 1);
    const committedMarker = (await context.cookies()).find(
      (cookie) => cookie.name === "volt-checkout-attempt-marker-local-v1",
    );
    assert.match(
      committedMarker?.value ?? "",
      /^committed-cart\.[a-f0-9]{64}$/,
    );

    await page.goto(`${BASE_URL}/checkout`, { waitUntil: "networkidle" });
    await fillCheckout(page, `cart-write-retry-${randomUUID()}@example.test`);
    await page
      .locator("form")
      .evaluate((form) =>
        (form instanceof HTMLFormElement ? form : null)?.requestSubmit(),
      );
    await page
      .getByRole("alert")
      .getByText(
        /eerder opgeslagen winkelwagen kan niet opnieuw worden verstuurd/i,
      )
      .waitFor();
    assert.equal(observedKeys.length, 1);
  } finally {
    await page.unroute("**/*", failCartPersistenceAfterCommit).catch(() => {});
    await context.close();
  }
});

test("a stale cart tab cannot restore and resubmit a completed cart generation", async () => {
  const { context, page: checkoutTab } = await newPage();
  const staleTab = await context.newPage();
  const observedKeys = [];
  const captureOrders = async (route) => {
    const request = route.request();
    const key = (request.postData() ?? "").match(
      /checkout-v2-[a-f0-9]{64}/,
    )?.[0];
    if (request.method() !== "POST" || !key) {
      await route.continue();
      return;
    }
    observedKeys.push(key);
    const response = await route.fetch();
    assert.equal(response.status(), 200, "Checkout kreeg geen 200-response");
    await route.fulfill({ response });
  };

  try {
    await context.route("**/*", captureOrders);
    await addPenAndOpenCheckout(checkoutTab);
    const completedEpoch = (await cartState(checkoutTab)).cartEpoch;
    assert.ok(Number.isSafeInteger(completedEpoch));

    await staleTab.goto(BASE_URL, { waitUntil: "networkidle" });
    await staleTab.waitForFunction(async () => {
      const { useCartStore } = await import("/src/lib/cart-store.ts");
      return useCartStore.getState().lines.length === 1;
    });
    assert.equal(
      await staleTab.evaluate(async () => {
        const { useCartStore } = await import("/src/lib/cart-store.ts");
        return useCartStore.getState().cartEpoch;
      }),
      completedEpoch,
    );

    await fillCheckout(
      checkoutTab,
      `cart-epoch-first-${randomUUID()}@example.test`,
    );
    const firstSubmit = await waitForCheckoutSubmit(checkoutTab);
    await firstSubmit.click();
    await checkoutTab.waitForURL(/\/bestelling\/[^/]+$/, {
      timeout: 15_000,
    });
    await checkoutTab
      .getByRole("heading", { name: "Bewaar je herstelcode" })
      .waitFor();
    assert.equal(observedKeys.length, 1);
    assert.equal(
      await checkoutTab.evaluate(() =>
        JSON.parse(
          localStorage.getItem("volt-cart-completed-epoch-v1") || "null",
        ),
      ),
      completedEpoch,
    );

    // This tab still owns the pre-checkout Zustand state. Its write restores
    // the old cart object, but must not be allowed to invent a new order after
    // a hard reload has created/adopted another checkout attempt.
    await staleTab.evaluate(async () => {
      const { useCartStore } = await import("/src/lib/cart-store.ts");
      const line = useCartStore.getState().lines[0];
      useCartStore.getState().setLineQty(line.slug, line.optionId, 2);
    });
    assert.equal((await cartState(staleTab)).cartEpoch, completedEpoch);
    assert.equal((await cartState(staleTab)).lines[0].qty, 2);

    await staleTab.reload({ waitUntil: "networkidle" });
    await staleTab.goto(`${BASE_URL}/checkout`, { waitUntil: "networkidle" });
    await staleTab
      .getByRole("heading", { name: "Waar mogen we bezorgen?" })
      .waitFor();
    await fillCheckout(
      staleTab,
      `cart-epoch-stale-${randomUUID()}@example.test`,
    );
    const staleSubmit = await waitForCheckoutSubmit(staleTab);
    await staleSubmit.click();
    await staleTab
      .getByRole("alert")
      .getByText(/eerder opgeslagen winkelwagen kan niet opnieuw/i)
      .waitFor();
    assert.equal(observedKeys.length, 1);

    const freshEpoch = await staleTab.evaluate(async () => {
      const { useCartStore } = await import("/src/lib/cart-store.ts");
      useCartStore.getState().clearCart();
      return useCartStore.getState().cartEpoch;
    });
    assert.ok(freshEpoch > completedEpoch);

    await addPenAndOpenCheckout(staleTab);
    assert.equal((await cartState(staleTab)).cartEpoch, freshEpoch);
    await fillCheckout(
      staleTab,
      `cart-epoch-fresh-${randomUUID()}@example.test`,
    );
    const freshSubmit = await waitForCheckoutSubmit(staleTab);
    await freshSubmit.click();
    await staleTab.waitForURL(/\/bestelling\/[^/]+$/, { timeout: 15_000 });
    await staleTab
      .getByRole("heading", { name: "Bewaar je herstelcode" })
      .waitFor();
    assert.equal(observedKeys.length, 2);
    assert.notEqual(observedKeys[1], observedKeys[0]);
  } finally {
    await context.unroute("**/*", captureOrders).catch(() => {});
    await context.close();
  }
});

test("a crash while confirmation navigation is pending safely replays the same order", async () => {
  const { context, page } = await newPage();
  const checkoutEmail = `navigate-pending-${randomUUID()}@example.test`;
  const observedOrderIds = [];
  const observedKeys = [];
  const captureOrders = async (route) => {
    const request = route.request();
    const key = (request.postData() ?? "").match(
      /checkout-v2-[a-f0-9]{64}/,
    )?.[0];
    if (request.method() !== "POST" || !key) {
      await route.continue();
      return;
    }
    observedKeys.push(key);
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    const responseBody = await response.text();
    const serialized = JSON.parse(responseBody);
    const resultNode = serializedServerProperty(serialized, "result");
    const orderNode = serializedServerProperty(resultNode, "order");
    const orderIdNode = serializedServerProperty(orderNode, "id");
    assert.equal(orderIdNode?.t, 1);
    observedOrderIds.push(orderIdNode.s);
    await route.fulfill({ response, body: responseBody });
  };

  try {
    await addPenAndOpenCheckout(page);
    await fillCheckout(page, checkoutEmail);
    const attemptBeforeSubmit = await page.evaluate(async () => {
      const { CHECKOUT_ATTEMPT_STORAGE_KEY } =
        await import("/src/lib/checkout-idempotency.ts");
      return localStorage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
    });
    assert.ok(attemptBeforeSubmit);
    await page.evaluate(() => {
      const router = globalThis.__TSR_ROUTER__;
      const nativeNavigate = router.navigate;
      let holdConfirmation = true;
      router.navigate = function (options) {
        if (holdConfirmation && options?.to === "/bestelling/$id") {
          holdConfirmation = false;
          globalThis.__voltConfirmationNavigatePending = true;
          return new Promise(() => undefined);
        }
        return nativeNavigate.call(router, options);
      };
    });
    await page.route("**/*", captureOrders);

    const placeOrder = await waitForCheckoutSubmit(page);
    await placeOrder.click();
    await page.waitForFunction(
      () => globalThis.__voltConfirmationNavigatePending === true,
    );
    assert.equal(new URL(page.url()).pathname, "/checkout");
    assert.equal((await cartState(page)).lines.length, 1);
    const attemptWhilePending = await page.evaluate(async () => {
      const { CHECKOUT_ATTEMPT_STORAGE_KEY } =
        await import("/src/lib/checkout-idempotency.ts");
      return localStorage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
    });
    assert.equal(
      JSON.parse(attemptWhilePending).seed,
      JSON.parse(attemptBeforeSubmit).seed,
    );

    // Simulate a tab crash before the bounded native anchor can run.
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(new URL(page.url()).pathname, "/checkout");
    assert.equal((await cartState(page)).lines.length, 1);
    await fillCheckout(page, checkoutEmail);
    const replayButton = await waitForCheckoutSubmit(page);
    await replayButton.click();
    await page.waitForURL(/\/bestelling\/[^/]+$/, { timeout: 15_000 });
    await page
      .getByRole("heading", { name: "Bewaar je herstelcode" })
      .waitFor();

    assert.equal(observedKeys.length, 2);
    assert.equal(observedKeys[1], observedKeys[0]);
    assert.equal(observedOrderIds.length, 2);
    assert.equal(observedOrderIds[1], observedOrderIds[0]);
    assert.deepEqual((await cartState(page)).lines, []);
    assert.equal(
      await page.evaluate(async () => {
        const { CHECKOUT_ATTEMPT_STORAGE_KEY } =
          await import("/src/lib/checkout-idempotency.ts");
        return localStorage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
      }),
      null,
    );
  } finally {
    await page.unroute("**/*", captureOrders).catch(() => {});
    await context.close();
  }
});

test("a navigation failure keeps the same order accessible after reload", async () => {
  const { context, page } = await newPage();
  const checkoutEmail = `navigate-fail-${randomUUID()}@example.test`;
  let orderRequests = 0;
  let capturedRecoveryCode;
  const captureOrderResponse = async (route) => {
    const request = route.request();
    if (
      request.method() === "POST" &&
      /checkout-v2-[a-f0-9]{64}/.test(request.postData() ?? "")
    ) {
      orderRequests += 1;
      const response = await route.fetch();
      const responseBody = await response.text();
      const serialized = JSON.parse(responseBody);
      const tokenNode = serializedServerProperty(
        serializedServerProperty(serialized, "result"),
        "guestAccessToken",
      );
      assert.equal(
        tokenNode?.t,
        1,
        "De bevestigde response bevatte geen herstelcode",
      );
      capturedRecoveryCode = tokenNode.s;
      await route.fulfill({ response, body: responseBody });
      return;
    }
    await route.continue();
  };

  try {
    await addPenAndOpenCheckout(page);
    await fillCheckout(page, checkoutEmail);
    await page.evaluate(() => {
      const router = globalThis.__TSR_ROUTER__;
      const nativeNavigate = router.navigate;
      globalThis.__restoreCheckoutNavigate = () => {
        router.navigate = nativeNavigate;
      };
      let rejectConfirmation = true;
      router.navigate = function (options) {
        if (rejectConfirmation && options?.to === "/bestelling/$id") {
          rejectConfirmation = false;
          return Promise.reject(new Error("Navigatie tijdelijk mislukt"));
        }
        return nativeNavigate.call(router, options);
      };
    });
    await page.route("**/*", captureOrderResponse);

    const placeOrder = await waitForCheckoutSubmit(page);
    await placeOrder.click();
    await page
      .getByRole("heading", { name: "Bestelling is geplaatst" })
      .waitFor({ timeout: 15_000 });
    const committedPath = new URL(page.url()).pathname;
    assert.match(committedPath, /^\/bestelling\/[^/]+$/);
    const committedOrderId = decodeURIComponent(
      committedPath.split("/").at(-1),
    );
    const committedOrderNumber = (
      await page.getByText(/^VOLT-[A-Z0-9]{8}$/).innerText()
    ).trim();
    assert.equal(orderRequests, 1);
    assert.equal(
      await page.getByText(/Bestelling plaatsen is niet gelukt/).count(),
      0,
    );
    assert.equal((await cartState(page)).lines.length, 0);
    await page
      .getByText(/Open de bevestiging vóór je deze pagina herlaadt/i)
      .waitFor();
    assert.ok(capturedRecoveryCode?.length >= 8);
    const browserStorage = await page.evaluate(() => ({
      local: Object.entries(localStorage),
      session: Object.entries(sessionStorage),
    }));
    const serializedBrowserStorage = JSON.stringify(browserStorage);
    assert.equal(
      serializedBrowserStorage.includes(capturedRecoveryCode),
      false,
    );

    // Reload directly from the native fallback URL. No router link is allowed
    // to repair the navigation first, otherwise this would be a false-green.
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(new URL(page.url()).pathname, committedPath);
    const reloadedOrderNumber = page.getByRole("heading", {
      level: 1,
      name: committedOrderNumber,
    });
    await reloadedOrderNumber.waitFor({ timeout: 15_000 });
    assert.equal(
      decodeURIComponent(new URL(page.url()).pathname.split("/").at(-1)),
      committedOrderId,
    );
    assert.equal(
      await page.getByText("Bestelling niet beschikbaar").count(),
      0,
    );
    assert.equal(
      await page
        .getByRole("heading", { name: "Bewaar je herstelcode" })
        .count(),
      0,
    );
    await page.getByText(/Als gast kun je deze bestelling.*72 uur/i).waitFor();
    const guestCookie = (await context.cookies()).find(
      (cookie) => cookie.name === "__Host-volt-order-access",
    );
    assert.equal(guestCookie?.httpOnly, true);
    assert.equal(orderRequests, 1);
  } finally {
    await page.unroute("**/*", captureOrderResponse).catch(() => {});
    await context.close();
  }
});

test("successful checkout never reuses a seed when storage cleanup fails", async () => {
  // This regression sends several order requests across four isolated browser
  // contexts. Start it with a fresh in-memory rate-limit bucket so preceding
  // checkout cases cannot turn its final scenario into an unrelated 429.
  await restartDevServerWithFreshDatabase();
  const scenarios = [
    {
      name: "remove throws",
      removeFailure: "throws",
      failReplacementWrite: false,
      expectNextRequest: true,
      hardReloadBeforeNextCheckout: false,
    },
    {
      name: "remove is a silent no-op",
      removeFailure: "no-op",
      failReplacementWrite: false,
      expectNextRequest: true,
      hardReloadBeforeNextCheckout: false,
    },
    {
      name: "cleanup and replacement writes are ignored",
      removeFailure: "no-op",
      failReplacementWrite: true,
      expectNextRequest: false,
      hardReloadBeforeNextCheckout: false,
    },
    {
      name: "storage recovers after a hard reload",
      removeFailure: "no-op",
      failReplacementWrite: true,
      expectNextRequest: true,
      hardReloadBeforeNextCheckout: true,
    },
  ];

  for (const scenario of scenarios) {
    const { context, page } = await newPage();
    const observedKeys = [];
    let firstResponseStatus;
    const handleOrders = async (route) => {
      const request = route.request();
      const key = (request.postData() ?? "").match(
        /checkout-v2-[a-f0-9]{64}/,
      )?.[0];
      if (request.method() !== "POST" || !key) {
        await route.continue();
        return;
      }

      observedKeys.push(key);
      if (observedKeys.length > 1) {
        await route.abort("failed");
        return;
      }

      const response = await route.fetch();
      firstResponseStatus = response.status();
      if (scenario.failReplacementWrite) {
        await page.evaluate(() => {
          globalThis.__voltFailCheckoutStorageWrites = true;
        });
      }
      await route.fulfill({ response });
    };

    try {
      await addPenAndOpenCheckout(page);
      await fillCheckout(
        page,
        `cleanup-${scenario.removeFailure}-${randomUUID()}@example.test`,
      );
      const placeOrder = await waitForCheckoutSubmit(page);
      await page.evaluate(async ({ removeFailure, failReplacementWrite }) => {
        const { CHECKOUT_ATTEMPT_STORAGE_KEY } =
          await import("/src/lib/checkout-idempotency.ts");
        const nativeRemoveItem = Storage.prototype.removeItem;
        const nativeSetItem = Storage.prototype.setItem;
        globalThis.__voltFailCheckoutStorageWrites = false;
        Storage.prototype.removeItem = function (key) {
          if (key === CHECKOUT_ATTEMPT_STORAGE_KEY) {
            if (removeFailure === "throws") {
              throw new DOMException("Opslag geweigerd", "SecurityError");
            }
            return;
          }
          return nativeRemoveItem.call(this, key);
        };
        if (failReplacementWrite) {
          Storage.prototype.setItem = function (key, value) {
            if (
              key === CHECKOUT_ATTEMPT_STORAGE_KEY &&
              globalThis.__voltFailCheckoutStorageWrites
            ) {
              return;
            }
            return nativeSetItem.call(this, key, value);
          };
        }
      }, scenario);
      await page.route("**/*", handleOrders);

      await Promise.all([
        page.waitForURL(/\/bestelling\/[^/]+$/, {
          timeout: 30_000,
          waitUntil: "commit",
        }),
        placeOrder.click(),
      ]);
      await page
        .getByRole("heading", { name: "Bewaar je herstelcode" })
        .waitFor();
      assert.equal(firstResponseStatus, 200, scenario.name);
      assert.equal(observedKeys.length, 1, scenario.name);

      if (scenario.hardReloadBeforeNextCheckout) {
        const staleSeed = await page.evaluate(async () => {
          const { CHECKOUT_ATTEMPT_STORAGE_KEY } =
            await import("/src/lib/checkout-idempotency.ts");
          return JSON.parse(localStorage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY))
            .seed;
        });
        const consumedMarker = (await context.cookies()).find(
          (cookie) => cookie.name === "volt-checkout-attempt-marker-local-v1",
        );
        assert.ok(consumedMarker);
        assert.match(consumedMarker.value, /^consumed\.[a-f0-9]{64}$/);
        assert.notEqual(consumedMarker.value.split(".")[1], staleSeed);
        assert.equal(consumedMarker.path, "/");
        assert.equal(consumedMarker.sameSite, "Strict");
        assert.ok(
          consumedMarker.expires * 1_000 - Date.now() >= 71 * 60 * 60 * 1_000,
        );
        assert.ok(
          consumedMarker.expires * 1_000 - Date.now() <= 72 * 60 * 60 * 1_000,
        );
        await context.addCookies([
          {
            name: "volt-checkout-attempt-marker-local-v1",
            value: "%E0%A4%A",
            domain: "127.0.0.1",
            path: "/checkout",
            expires: Math.floor(Date.now() / 1_000) + 60 * 60,
            sameSite: "Strict",
          },
        ]);
        const duplicateMarkers = (await context.cookies()).filter(
          (cookie) => cookie.name === "volt-checkout-attempt-marker-local-v1",
        );
        assert.equal(duplicateMarkers.length, 2);
        assert.ok(
          duplicateMarkers.some(
            (cookie) =>
              cookie.path === "/checkout" && cookie.domain === "127.0.0.1",
          ),
        );
        await page.reload({ waitUntil: "networkidle" });
      }
      await page.getByRole("link", { name: "Verder winkelen" }).click();
      await page.waitForURL(`${BASE_URL}/`);
      await page
        .locator("#producten article")
        .filter({ hasText: "Semaglutide 4mg" })
        .getByRole("button", { name: "In winkelwagen" })
        .click();
      await page.getByRole("link", { name: "Veilig afrekenen" }).click();
      await page.waitForURL(`${BASE_URL}/checkout`);
      await fillCheckout(
        page,
        `cleanup-next-${scenario.removeFailure}-${randomUUID()}@example.test`,
      );
      const nextPlaceOrder = await waitForCheckoutSubmit(page);
      await nextPlaceOrder.click();

      if (scenario.expectNextRequest) {
        await page.getByText(/Je winkelwagen is bewaard/).waitFor();
        assert.equal(observedKeys.length, 2, scenario.name);
        assert.notEqual(observedKeys[1], observedKeys[0], scenario.name);
      } else {
        await page
          .getByRole("alert")
          .getByText(
            "De veilige herhaalbeveiliging kon niet worden opgeslagen. Sta browseropslag toe en probeer opnieuw.",
            { exact: true },
          )
          .waitFor();
        assert.equal(observedKeys.length, 1, scenario.name);
      }
    } finally {
      await page.unroute("**/*", handleOrders).catch(() => {});
      await context.close();
    }
  }
});

test("checkout replaces corrupt storage and keeps one key for an unresolved attempt", async () => {
  const { context, page } = await newPage();
  const checkoutEmail = `seed-${randomUUID()}@example.test`;
  const observedKeys = [];
  const waitForObservedKeys = async (count) => {
    const deadline = Date.now() + 10_000;
    while (observedKeys.length < count) {
      if (Date.now() >= deadline) {
        throw new Error(
          `Expected ${count} checkout requests, got ${observedKeys.length}`,
        );
      }
      await page.waitForTimeout(25);
    }
  };
  const rejectOrders = async (route) => {
    const request = route.request();
    const body = request.postData() ?? "";
    const key = body.match(/checkout-v2-[a-f0-9]{64}/)?.[0];
    if (request.method() === "POST" && key) {
      observedKeys.push(key);
      await route.abort("failed");
      return;
    }
    await route.continue();
  };

  try {
    await page.goto(`${BASE_URL}/product/semaglutide-4mg-pen`, {
      waitUntil: "networkidle",
    });
    await page.evaluate(async () => {
      const { CHECKOUT_ATTEMPT_STORAGE_KEY } =
        await import("/src/lib/checkout-idempotency.ts");
      localStorage.setItem(
        CHECKOUT_ATTEMPT_STORAGE_KEY,
        JSON.stringify({
          version: 1,
          seed: "bad",
          expiresAt: Date.now() + 60_000,
          name: "Dit mag niet bewaard blijven",
        }),
      );
    });
    await page
      .getByRole("button", { name: /^In winkelwagen/ })
      .first()
      .click();
    await page.getByRole("link", { name: "Veilig afrekenen" }).click();
    await page.waitForURL(`${BASE_URL}/checkout`);
    await fillCheckout(page, checkoutEmail);
    const placeOrder = await waitForCheckoutSubmit(page);
    const safeAttempt = await page.evaluate(async () => {
      const { CHECKOUT_ATTEMPT_STORAGE_KEY } =
        await import("/src/lib/checkout-idempotency.ts");
      return localStorage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
    });
    assert.ok(safeAttempt);
    assert.match(JSON.parse(safeAttempt).seed, /^[a-f0-9]{64}$/);
    assert.deepEqual(Object.keys(JSON.parse(safeAttempt)).sort(), [
      "expiresAt",
      "seed",
      "version",
    ]);
    assert.doesNotMatch(safeAttempt, /Dit mag niet|Noor|Teststraat/);

    await page.route("**/*", rejectOrders);
    await placeOrder.click();
    await page.getByText(/Je winkelwagen is bewaard/).waitFor();
    await placeOrder.click();
    await waitForObservedKeys(2);
    await page.getByLabel("Straat").fill("Andere straat");
    await placeOrder.click();
    await waitForObservedKeys(3);

    assert.equal(observedKeys[0], observedKeys[1]);
    assert.equal(observedKeys[1], observedKeys[2]);
    const finalAttempt = await page.evaluate(async () => {
      const { CHECKOUT_ATTEMPT_STORAGE_KEY } =
        await import("/src/lib/checkout-idempotency.ts");
      return localStorage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
    });
    assert.equal(JSON.parse(finalAttempt).seed, JSON.parse(safeAttempt).seed);
    assert.ok(
      JSON.parse(finalAttempt).expiresAt >= JSON.parse(safeAttempt).expiresAt,
    );
  } finally {
    await page.unroute("**/*", rejectOrders).catch(() => {});
    await context.close();
  }
});

test("checkout hides stale pricing immediately and ignores late responses", async () => {
  const { context, page } = await newPage();
  let pricingRequests = 0;
  let orderRequests = 0;
  let releaseFirstPricing;
  let markFirstPricingFulfilled;
  let firstPricingTimeout;
  const firstPricingHeld = new Promise((resolve) => {
    releaseFirstPricing = resolve;
  });
  const firstPricingFulfilled = new Promise((resolve, reject) => {
    firstPricingTimeout = setTimeout(
      () => reject(new Error("Eerste pricingresponse is niet vrijgegeven.")),
      15_000,
    );
    markFirstPricingFulfilled = () => {
      clearTimeout(firstPricingTimeout);
      resolve();
    };
  });
  const holdFirstPricing = async (route) => {
    const request = route.request();
    const body = request.postData() ?? "";
    if (request.method() === "POST" && body.includes("checkout-v2-")) {
      orderRequests += 1;
      await route.abort("failed");
      return;
    }
    if (
      request.method() === "POST" &&
      body.includes("semaglutide-4mg-pen") &&
      !body.includes("checkout-v2-")
    ) {
      const requestNumber = ++pricingRequests;
      const response = await route.fetch();
      if (requestNumber === 1) await firstPricingHeld;
      await route.fulfill({ response });
      if (requestNumber === 1) markFirstPricingFulfilled();
      return;
    }
    await route.continue();
  };

  try {
    await addPenAndOpenCheckout(page);
    await fillCheckout(page, `pricing-race-${randomUUID()}@example.test`);
    const placeOrder = await waitForCheckoutSubmit(page);
    await page.getByText("4 mg · 1 stuks", { exact: true }).waitFor();
    await page.route("**/*", holdFirstPricing);

    await page
      .getByRole("button", { name: /Winkelwagen openen, 1 product/ })
      .first()
      .click();
    await page
      .getByRole("button", { name: "Aantal verhogen in winkelwagen" })
      .click();
    await page.getByRole("button", { name: "Winkelwagen sluiten" }).click();
    await page
      .getByRole("status")
      .getByText("Actuele totalen berekenen…", { exact: true })
      .waitFor();
    assert.equal(await placeOrder.isDisabled(), true);
    assert.equal(
      await page.getByText("4 mg · 1 stuks", { exact: true }).count(),
      0,
    );
    await page
      .locator("form")
      .first()
      .evaluate((form) => form.requestSubmit());
    await page
      .getByRole("alert")
      .getByText("Wacht tot de actuele totalen zijn berekend.", { exact: true })
      .waitFor();
    assert.equal(orderRequests, 0);

    await page
      .getByRole("button", { name: /Winkelwagen openen, 2 producten/ })
      .first()
      .click();
    await page
      .getByRole("button", { name: "Aantal verhogen in winkelwagen" })
      .click();
    await page.getByRole("button", { name: "Winkelwagen sluiten" }).click();
    await page.getByText("4 mg · 3 stuks", { exact: true }).waitFor();
    await waitForCheckoutSubmit(page);
    assert.equal(pricingRequests, 2);

    releaseFirstPricing();
    await firstPricingFulfilled;
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    assert.equal(
      await page.getByText("4 mg · 3 stuks", { exact: true }).count(),
      1,
    );
    assert.equal(
      await page.getByText("4 mg · 2 stuks", { exact: true }).count(),
      0,
    );
    assert.equal(await placeOrder.isDisabled(), false);
  } finally {
    clearTimeout(firstPricingTimeout);
    markFirstPricingFulfilled?.();
    releaseFirstPricing?.();
    await page.unroute("**/*", holdFirstPricing).catch(() => {});
    await context.close();
  }
});

test("checkout shows server-shared postcode feedback without clearing the cart", async () => {
  const { context, page } = await newPage();
  try {
    await page.goto(`${BASE_URL}/product/semaglutide-4mg-pen`, {
      waitUntil: "networkidle",
    });
    await page
      .getByRole("button", { name: /^In winkelwagen/ })
      .first()
      .click();
    await page.getByRole("link", { name: "Veilig afrekenen" }).click();
    await page.waitForURL(`${BASE_URL}/checkout`);
    await fillCheckout(page, `postcode-${randomUUID()}@example.test`);
    await page.getByLabel("Postcode").fill("abc");
    await page.getByRole("button", { name: "Bestelling plaatsen" }).click();

    await page.getByText("Vul een geldige Nederlandse postcode in.").waitFor();
    assert.equal(page.url(), `${BASE_URL}/checkout`);
    assert.equal((await cartState(page)).lines.length, 1);
  } finally {
    await context.close();
  }
});

test("checkout shows actionable idempotency conflict feedback without a guest account link", async () => {
  // This file intentionally exercises the real public rate limit. Earlier
  // checkout cases share one dev-server IP, so give this conflict regression a
  // fresh in-memory test database instead of weakening or bypassing production.
  await restartDevServerWithFreshDatabase();
  const { context, page } = await newPage();
  const checkoutEmail = `conflict-tweede-${Date.now()}@example.test`;
  try {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.evaluate(async () => {
      const { checkoutIdempotencyKeyFromSeed, initializeCheckoutAttemptSeed } =
        await import("/src/lib/checkout-idempotency.ts");
      const { createOrder } = await import("/src/lib/server/orders.ts");
      const attempt = await initializeCheckoutAttemptSeed();
      if (!attempt) throw new Error("Checkoutpoging kon niet worden bewaard.");
      const fixedKey = await checkoutIdempotencyKeyFromSeed(attempt.seed);
      await createOrder({
        data: {
          name: "Eerste conflictbestelling",
          email: `conflict-eerste-${Date.now()}@example.test`,
          phone: "0612345678",
          street: "Eerste straat",
          houseNumber: "1",
          postcode: "1234 AB",
          city: "Utrecht",
          country: "NL",
          note: "Bestaande bestelling voor de echte RPC-conflicttest.",
          lines: [{ slug: "semaglutide-2mg", optionId: "none", qty: 1 }],
          idempotencyKey: fixedKey,
        },
      });
    });

    await page.goto(`${BASE_URL}/product/semaglutide-4mg-pen`, {
      waitUntil: "networkidle",
    });
    await page
      .getByRole("button", { name: /^In winkelwagen/ })
      .first()
      .click();
    await page.getByRole("link", { name: "Veilig afrekenen" }).click();
    await page.waitForURL(`${BASE_URL}/checkout`);
    await fillCheckout(page, checkoutEmail);

    const conflictResponse = page.waitForResponse((response) =>
      /checkout-v2-[a-f0-9]{64}/.test(response.request().postData() ?? ""),
    );
    await page.getByRole("button", { name: "Bestelling plaatsen" }).click();
    assert.equal(
      (await conflictResponse).status(),
      409,
      "De conflicttest ontving onverwacht een andere serverstatus (bijvoorbeeld 429); iedere storefront-run hoort een eigen testdatabase te gebruiken.",
    );

    const conflictAlert = page.getByRole("alert");
    await conflictAlert.waitFor();
    assert.match(
      await conflictAlert.innerText(),
      /^Deze bestelling is al geplaatst\./,
    );
    assert.match(
      await conflictAlert.innerText(),
      /Zet de oorspronkelijke gegevens terug en probeer opnieuw/,
    );
    assert.equal(
      await conflictAlert
        .getByRole("link", { name: "Bekijk je bestellingen." })
        .count(),
      0,
    );
    await page.waitForFunction(
      () => document.activeElement?.getAttribute("role") === "alert",
    );
    assert.equal((await cartState(page)).lines.length, 1);
  } finally {
    await context.close();
  }
});

async function verifyAdminNextOrderStatuses(context, page, orderNumber) {
  await page.goto(`${BASE_URL}/admin`, { waitUntil: "networkidle" });
  await page
    .getByRole("link", { name: "Inloggen met toegestaan account" })
    .waitFor();
  const rejectedLogin = page.waitForResponse(
    (response) => response.status() === 401,
  );
  await page.getByLabel("Beheerwachtwoord").fill("onjuist-wachtwoord");
  const rejectedAt = Date.now();
  await page.getByRole("button", { name: "Inloggen" }).click();
  assert.equal((await rejectedLogin).status(), 401);
  assert.ok(Date.now() - rejectedAt >= 200);
  await page.getByText(/Inloggen mislukt/).waitFor();
  await page.getByLabel("Beheerwachtwoord").fill(TEST_ADMIN_PASSWORD);
  const acceptedAt = Date.now();
  await page.getByRole("button", { name: "Inloggen" }).click();
  await page.getByRole("heading", { name: "Shopbeheer" }).waitFor();
  assert.ok(Date.now() - acceptedAt >= 200);
  const adminCookie = (await context.cookies()).find(
    (cookie) => cookie.name === "__Host-volt-admin-session",
  );
  assert.ok(adminCookie);
  assert.equal(adminCookie.secure, true);
  assert.equal(adminCookie.path, "/");
  assert.equal(adminCookie.sameSite, "Strict");
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Shopbeheer" }).waitFor();
  assert.equal(await page.getByLabel("Beheerwachtwoord").count(), 0);
  const ordersTab = page.getByRole("tab", { name: "Bestellingen" });
  const contactTab = page.getByRole("tab", { name: "Contact" });
  const assertActiveTab = async (activeTab, inactiveTab) => {
    assert.equal(await activeTab.getAttribute("aria-selected"), "true");
    assert.equal(await inactiveTab.getAttribute("aria-selected"), "false");
    assert.equal(
      await activeTab.evaluate((element) => element === document.activeElement),
      true,
    );
  };
  await page
    .getByRole("group", { name: "Nieuw / in afwachting" })
    .getByText(/^\d+$/)
    .waitFor();
  await page
    .getByRole("group", { name: "Te verwerken" })
    .getByText(/^\d+$/)
    .waitFor();
  await page
    .getByRole("group", { name: "Open contact" })
    .getByText("0", { exact: true })
    .waitFor();

  let aborted = false;
  await page.route("**/*", async (route) => {
    if (!aborted && route.request().resourceType() === "fetch") {
      aborted = true;
      await route.abort();
    } else {
      await route.continue();
    }
  });
  await page.getByPlaceholder("Nummer, naam of e-mail").fill("bestaat-niet");
  await page.getByRole("button", { name: "Zoeken" }).click();
  await page.getByText("Bestellingen konden niet worden geladen.").waitFor();
  await page.unroute("**/*");
  await page.getByRole("button", { name: "Opnieuw proberen" }).click();
  await page.getByText("Geen bestellingen gevonden.").waitFor();

  await ordersTab.focus();
  await page.keyboard.press("ArrowLeft");
  await assertActiveTab(contactTab, ordersTab);
  await page.keyboard.press("ArrowLeft");
  await assertActiveTab(ordersTab, contactTab);
  await page.keyboard.press("ArrowRight");
  await assertActiveTab(contactTab, ordersTab);
  await page.keyboard.press("ArrowRight");
  await assertActiveTab(ordersTab, contactTab);
  await page.keyboard.press("End");
  await assertActiveTab(contactTab, ordersTab);
  await page.keyboard.press("Home");
  await assertActiveTab(ordersTab, contactTab);
  await page.waitForLoadState("networkidle");

  await page.getByPlaceholder("Nummer, naam of e-mail").fill(orderNumber);
  await page.getByRole("button", { name: "Zoeken" }).click();
  await page.getByLabel("Filter op status").selectOption("pending");
  const openOrder = page.getByRole("button", {
    name: `Bekijk bestelling ${orderNumber}`,
  });
  await openOrder.focus();
  await page.keyboard.press("Enter");
  const detail = page.getByLabel(`Besteldetail ${orderNumber}`);
  await detail.waitFor({ state: "visible" });
  assert.equal(
    await detail.evaluate((element) => element === document.activeElement),
    true,
  );
  await detail.getByRole("button", { name: "Sluiten" }).click();
  await page.waitForFunction(
    (label) => document.activeElement?.getAttribute("aria-label") === label,
    `Bekijk bestelling ${orderNumber}`,
  );
  await page.keyboard.press("Enter");
  await detail.waitFor({ state: "visible" });

  const status = page.getByLabel("Volgende status");
  await status.waitFor({ state: "visible" });
  assert.deepEqual(
    await status
      .locator("option")
      .evaluateAll((options) => options.map((option) => option.value)),
    ["pending", "paid", "cancelled"],
  );
  await status.selectOption("paid");
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Status opslaan" }).click();
  await page.getByText("Status bijgewerkt naar Betaald.").waitFor();
  await detail.getByRole("button", { name: "Sluiten" }).click();
  await page.waitForFunction(
    () =>
      document.activeElement?.getAttribute("placeholder") ===
      "Nummer, naam of e-mail",
  );

  const shopper = await context.newPage();
  await shopper.goto(BASE_URL, { waitUntil: "networkidle" });
  await shopper
    .getByRole("button", { name: "Contact", exact: true })
    .last()
    .click();
  await shopper.getByLabel("Naam").fill("Dashboard Contact");
  await shopper
    .getByLabel("E-mail")
    .fill(`dashboard-${randomUUID()}@example.test`);
  await shopper
    .getByLabel("Bericht")
    .fill("Nieuw open contact voor de dashboardtelling.");
  await shopper.getByRole("button", { name: "Verstuur bericht" }).click();
  await shopper.getByText("Bericht verstuurd").waitFor();
  await shopper.close();

  await page.getByRole("button", { name: "Vernieuwen" }).click();
  await page
    .getByRole("group", { name: "Open contact" })
    .getByText("1", { exact: true })
    .waitFor();
}

test("contact is stored and only an authenticated admin can handle it", async () => {
  const { context, page } = await newPage({ width: 390, height: 844 });
  const uniqueMessage = `Contacttest ${randomUUID()} met voldoende tekens.`;
  try {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page
      .getByRole("button", { name: "Contact", exact: true })
      .last()
      .click();
    await page.getByLabel("Naam").fill("Contact Tester");
    await page
      .getByLabel("E-mail")
      .fill(`contact-${randomUUID()}@example.test`);
    await page.getByLabel("Bericht").fill(uniqueMessage);
    await page.getByRole("button", { name: "Verstuur bericht" }).click();
    await page.getByText("Bericht verstuurd").waitFor();

    await page.goto(`${BASE_URL}/admin`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Inloggen" }).waitFor();
    assert.equal(
      await page.getByRole("heading", { name: "Shopbeheer" }).count(),
      0,
    );
    let unauthorizedStatus;
    const captureUnauthorized = (response) => {
      if (response.status() === 401) unauthorizedStatus = 401;
    };
    page.on("response", captureUnauthorized);
    assert.equal(
      await page.evaluate(async () => {
        try {
          const { listOrders } = await import("/src/lib/server/orders.ts");
          await listOrders({ data: { status: "all", page: 1, pageSize: 20 } });
          return false;
        } catch {
          return true;
        }
      }),
      true,
    );
    page.off("response", captureUnauthorized);
    assert.equal(unauthorizedStatus, 401);

    await page.getByLabel("Beheerwachtwoord").fill(TEST_ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Inloggen" }).click();
    await page.getByRole("heading", { name: "Shopbeheer" }).waitFor();
    const summaryBoxes = await Promise.all(
      ["Nieuw / in afwachting", "Te verwerken", "Open contact"].map((name) =>
        page.getByRole("group", { name }).boundingBox(),
      ),
    );
    assert.ok(summaryBoxes.every(Boolean));
    assert.ok(
      summaryBoxes.every((box) => Math.abs(box.y - summaryBoxes[0].y) <= 2),
    );
    await page.getByRole("tab", { name: "Contact" }).click();
    await page.getByText(uniqueMessage).waitFor();
    const contactFilters = page.getByRole("group", {
      name: "Contactberichten filteren",
    });
    assert.equal(
      await contactFilters
        .getByRole("button", { name: "Open", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    const contactCard = page
      .locator("article")
      .filter({ hasText: uniqueMessage });
    await contactCard
      .getByRole("button", { name: "Markeer afgehandeld" })
      .click();
    await page
      .getByText("Contactbericht gemarkeerd als afgehandeld.")
      .waitFor();
    await page
      .getByRole("button", { name: "Afgehandeld", exact: true })
      .click();
    assert.equal(
      await contactFilters
        .getByRole("button", { name: "Afgehandeld", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    await page.getByText(uniqueMessage).waitFor();
  } finally {
    await context.close();
  }
});

test("contact abuse protection returns 429 with retry feedback", async () => {
  const { context, page } = await newPage();
  try {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    const seededLimit = await page.evaluate(async () => {
      const [{ createContactMessage }, { rateLimitFeedback }] =
        await Promise.all([
          import("/src/lib/server/contact.ts"),
          import("/src/lib/server-error.ts"),
        ]);
      for (let attempt = 0; attempt < 10; attempt += 1) {
        try {
          await createContactMessage({
            data: {
              name: "Rate Limit Seeder",
              email: `rate-seed-${attempt}-${crypto.randomUUID()}@example.test`,
              message: "Dit bericht vult bewust de publieke contactlimiet.",
            },
          });
        } catch (error) {
          return {
            attempts: attempt + 1,
            limited: Boolean(rateLimitFeedback(error)),
          };
        }
      }
      return { attempts: 10, limited: false };
    });
    assert.equal(seededLimit.limited, true);
    assert.ok(seededLimit.attempts <= 10);

    await page
      .getByRole("button", { name: "Contact", exact: true })
      .last()
      .click();
    const dialog = page.getByRole("dialog", { name: "Contact" });
    await dialog.getByLabel("Naam").fill("Rate Limit Tester");
    await dialog
      .getByLabel("E-mail")
      .fill(`rate-ui-${randomUUID()}@example.test`);
    await dialog
      .getByLabel("Bericht")
      .fill("Dit bericht controleert de gedeelde rate limit.");
    const limitedAttempt = page.waitForResponse(
      (response) =>
        response.status() === 429 && response.request().method() === "POST",
      { timeout: 15_000 },
    );
    await dialog.getByRole("button", { name: "Verstuur bericht" }).click();
    const limitedResponse = await limitedAttempt;
    const feedback = page.getByText(
      /Te veel pogingen. Probeer over \d+ seconden opnieuw/,
    );
    await feedback.waitFor();
    const retrySeconds = /over (\d+) seconden/.exec(
      await feedback.innerText(),
    )?.[1];
    assert.ok(retrySeconds);
    assert.equal(limitedResponse.headers()["retry-after"], retrySeconds);
  } finally {
    await context.close();
  }
});
