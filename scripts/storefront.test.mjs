import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";

const BASE_URL = "http://127.0.0.1:8080";
const TEST_ADMIN_PASSWORD = `test-${randomUUID()}`;
const TEST_ADMIN_SESSION_SECRET = `session-${randomUUID()}-${randomUUID()}`;
let browser;
let devServer;

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
    if (await isHealthy()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("VOLT dev server did not become ready");
}

async function newPage(viewport = { width: 1280, height: 800 }) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(() => {
    if (!sessionStorage.getItem("volt-test-initialized")) {
      localStorage.clear();
      sessionStorage.setItem("volt-test-initialized", "true");
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

before(async () => {
  if (!(await isHealthy())) {
    devServer = spawn("npm", ["run", "dev"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ADMIN_EMAILS: "allowlisted-admin@example.test",
        ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
        ADMIN_SESSION_SECRET: TEST_ADMIN_SESSION_SECRET,
      },
      stdio: "ignore",
      detached: true,
    });
  }
  await waitForServer();
  browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
});

after(async () => {
  await browser?.close();
  if (devServer?.pid) {
    try {
      process.kill(-devServer.pid, "SIGTERM");
    } catch {
      // The test-owned process group already exited.
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
      .filter({ hasText: "Andere sterkte / vorm" });
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
      .filter({ hasText: "Andere sterkte / vorm" });
    const text = await related.innerText();

    assert.doesNotMatch(text, /Tirzepatide/);
    assert.doesNotMatch(text, /Retatrutide/);
  } finally {
    await context.close();
  }
});

test("an invalid code does not replace an active VOLT10 discount", async () => {
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
    await input.fill("ONGELDIG");
    await page.getByRole("button", { name: "Toepassen" }).click();

    const state = await cartState(page);
    assert.equal(state.discountApplied, true);
    assert.equal(state.discountCode, "VOLT10");
  } finally {
    await context.close();
  }
});

test("the PDP sticky bar stays bound to the current product", async () => {
  const { context, page } = await newPage({ width: 390, height: 844 });
  try {
    await page.goto(`${BASE_URL}/product/semaglutide-2mg`, {
      waitUntil: "networkidle",
    });
    const related = page
      .locator("section")
      .filter({ hasText: "Andere sterkte / vorm" });
    await related
      .getByRole("button", { name: "In winkelwagen" })
      .first()
      .click();
    await page.getByRole("button", { name: "Winkelwagen sluiten" }).click();
    await related.scrollIntoViewIfNeeded();
    await page.waitForTimeout(350);

    const sticky = page.locator("div.fixed").filter({
      has: page.getByRole("button", { name: "Kopen" }),
    });
    await sticky.waitFor({ state: "visible" });
    assert.match(await sticky.innerText(), /Semaglutide 2mg/);
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

test("vial cards ask the shopper to choose required injection extras", async () => {
  const { context, page } = await newPage();
  try {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    const vialCard = page.locator("#producten article").first();
    await vialCard.getByRole("link", { name: "Kies extra's" }).waitFor({
      state: "visible",
    });
    assert.equal(
      await vialCard.getByRole("button", { name: "In winkelwagen" }).count(),
      0,
    );
  } finally {
    await context.close();
  }
});

test("vial options state the extra cost before purchase", async () => {
  const { context, page } = await newPage();
  try {
    await page.goto(`${BASE_URL}/product/semaglutide-2mg`, {
      waitUntil: "networkidle",
    });
    const syringeOption = page.getByRole("radio", {
      name: /10 insulinespuiten/,
    });
    assert.match(await syringeOption.innerText(), /\+ €\s?2,50/);
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

test("the home sticky product follows the active compound filter", async () => {
  const { context, page } = await newPage({ width: 390, height: 844 });
  try {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page
      .getByRole("button", { name: "Retatrutide", pressed: false })
      .click();
    await page.locator("#faq").scrollIntoViewIfNeeded();
    await page.waitForTimeout(350);

    const sticky = page.locator("div.fixed").filter({
      has: page.getByRole("link", { name: "Bekijk" }),
    });
    await sticky.waitFor({ state: "visible" });
    assert.match(await sticky.innerText(), /Retatrutide 10mg/);
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
      await page
        .locator("#prijzen")
        .getByText(/Voor 23:00 besteld/)
        .innerText(),
      /maandag 24 augustus/i,
    );
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
    await page.getByText("Stapelkorting (10%)").waitFor({ state: "visible" });
    await page
      .getByText("Korting (10%)", { exact: true })
      .waitFor({ state: "visible" });
    assert.equal(await page.getByText("Gratis", { exact: true }).count(), 1);
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
    await page.getByText("Semaglutide 4mg · Pen", { exact: true }).waitFor();
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

    const orderNumber = (
      await page.getByRole("heading", { level: 1 }).innerText()
    ).trim();
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
    const guestCookie = (await context.cookies()).find(
      (cookie) => cookie.name === "__Host-volt-order-access",
    );
    assert.ok(guestCookie);
    assert.equal(guestCookie.secure, true);
    assert.equal(guestCookie.path, "/");
    assert.equal(guestCookie.sameSite, "Strict");

    const orderUrl = page.url();
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

test("checkout shows real idempotency conflict feedback and an account link", async () => {
  const { context, page } = await newPage();
  const idempotencyKey = randomUUID();
  try {
    await page.addInitScript((fixedKey) => {
      Object.defineProperty(globalThis.crypto, "randomUUID", {
        configurable: true,
        value: () => fixedKey,
      });
    }, idempotencyKey);
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    assert.equal(
      await page.evaluate(() => crypto.randomUUID()),
      idempotencyKey,
    );

    await page.evaluate(async (fixedKey) => {
      const { createOrder } = await import("/src/lib/server/orders.ts");
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
    }, idempotencyKey);

    await page.goto(`${BASE_URL}/product/semaglutide-4mg-pen`, {
      waitUntil: "networkidle",
    });
    await page
      .getByRole("button", { name: /^In winkelwagen/ })
      .first()
      .click();
    await page.getByRole("link", { name: "Veilig afrekenen" }).click();
    await page.waitForURL(`${BASE_URL}/checkout`);
    await fillCheckout(page, `conflict-tweede-${Date.now()}@example.test`);

    const conflictResponse = page.waitForResponse(
      (response) => response.status() === 409,
    );
    await page.getByRole("button", { name: "Bestelling plaatsen" }).click();
    assert.equal((await conflictResponse).status(), 409);

    const conflictAlert = page.getByRole("alert");
    await conflictAlert.waitFor();
    assert.match(
      await conflictAlert.innerText(),
      /^Deze bestelling is al geplaatst\./,
    );
    const accountLink = conflictAlert.getByRole("link", {
      name: "Bekijk je bestellingen.",
    });
    await accountLink.waitFor();
    assert.equal(await accountLink.getAttribute("href"), "/account");
    assert.equal(
      await conflictAlert.evaluate(
        (element) => element === document.activeElement,
      ),
      true,
    );
    assert.equal((await cartState(page)).lines.length, 1);
  } finally {
    await context.close();
  }
});

test("admin only offers valid next order statuses", async () => {
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
    await fillCheckout(page, `status-${randomUUID()}@example.test`);
    await page.getByRole("button", { name: "Bestelling plaatsen" }).click();
    await page.waitForURL(/\/bestelling\/[^/]+$/);
    const orderNumber = (
      await page.getByRole("heading", { level: 1 }).innerText()
    ).trim();

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
        await activeTab.evaluate(
          (element) => element === document.activeElement,
        ),
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
  } finally {
    await context.close();
  }
});

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
  let limitedResponse;
  page.on("response", (response) => {
    if (response.status() === 429) limitedResponse = response;
  });
  try {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (limitedResponse) break;
      const dialog = page.getByRole("dialog", { name: "Contact" });
      if (!(await dialog.isVisible())) {
        await page
          .getByRole("button", { name: "Contact", exact: true })
          .last()
          .click();
      }
      await dialog.getByLabel("Naam").fill("Rate Limit Tester");
      await dialog
        .getByLabel("E-mail")
        .fill(`rate-${attempt}-${randomUUID()}@example.test`);
      await dialog
        .getByLabel("Bericht")
        .fill("Dit bericht controleert de gedeelde rate limit.");
      const limitedAttempt = page
        .waitForResponse((response) => response.status() === 429, {
          timeout: 10_000,
        })
        .catch(() => null);
      await dialog.getByRole("button", { name: "Verstuur bericht" }).click();
      const outcome = await Promise.race([
        limitedAttempt,
        dialog.waitFor({ state: "hidden", timeout: 10_000 }).then(() => null),
      ]);
      if (outcome) {
        limitedResponse = outcome;
        break;
      }
      if (limitedResponse) break;
    }

    assert.ok(limitedResponse);
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
