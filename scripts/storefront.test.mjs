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

test("a product can be ordered and only its authorized guest sees confirmation", async () => {
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
    await fillCheckout(page, `checkout-${randomUUID()}@example.test`);
    const placeOrder = page.getByRole("button", { name: "Bestelling plaatsen" });
    await placeOrder.waitFor({ state: "visible" });
    await assert.doesNotReject(async () => {
      await placeOrder.click();
      await page.waitForURL(/\/bestelling\/[^/]+$/, { timeout: 15_000 });
    });

    const orderNumber = (await page.getByRole("heading", { level: 1 }).innerText()).trim();
    assert.match(orderNumber, /^VOLT-[A-Z0-9]{8}$/);
    await page.getByRole("heading", { name: "Bewaar je herstelcode" }).waitFor();
    const recoveryCode = (await page.locator("code").innerText()).trim();
    assert.deepEqual((await cartState(page)).lines, []);

    const orderUrl = page.url();
    const denied = await newPage();
    try {
      await denied.page.goto(orderUrl, { waitUntil: "networkidle" });
      await denied.page
        .getByRole("heading", { name: "Bestelling niet beschikbaar" })
        .waitFor();
      assert.equal(await denied.page.getByText(orderNumber, { exact: true }).count(), 0);

      await denied.page.goto(`${BASE_URL}/account`, { waitUntil: "networkidle" });
      await denied.page.getByLabel("Bestelnummer").fill(orderNumber);
      await denied.page.getByLabel("Herstelcode").fill(recoveryCode);
      await denied.page.getByRole("button", { name: "Bestelling bekijken" }).click();
      await denied.page.waitForURL(/\/bestelling\/[^/]+$/);
      await denied.page.getByRole("heading", { name: orderNumber }).waitFor();
    } finally {
      await denied.context.close();
    }
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
    const placeOrder = page.getByRole("button", { name: "Bestelling plaatsen" });
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

    await page
      .getByText("Vul een geldige Nederlandse postcode in.")
      .waitFor();
    assert.equal(page.url(), `${BASE_URL}/checkout`);
    assert.equal((await cartState(page)).lines.length, 1);
  } finally {
    await context.close();
  }
});

test("admin only offers valid next order statuses", async () => {
  const { context, page } = await newPage({ width: 390, height: 844 });
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
    await page.getByLabel("Beheerwachtwoord").fill(TEST_ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Inloggen" }).click();
    await page.getByRole("heading", { name: "Shopbeheer" }).waitFor();
    await page.getByRole("button", { name: new RegExp(orderNumber) }).click();

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
    await page.getByText("Betaald", { exact: true }).last().waitFor();
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
    await page.getByLabel("E-mail").fill(`contact-${randomUUID()}@example.test`);
    await page.getByLabel("Bericht").fill(uniqueMessage);
    await page.getByRole("button", { name: "Verstuur bericht" }).click();
    await page.getByText("Bericht verstuurd").waitFor();

    await page.goto(`${BASE_URL}/admin`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Inloggen" }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "Shopbeheer" }).count(), 0);
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

    await page.getByLabel("Beheerwachtwoord").fill(TEST_ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Inloggen" }).click();
    await page.getByRole("heading", { name: "Shopbeheer" }).waitFor();
    await page.getByRole("button", { name: "Contact" }).click();
    await page.getByText(uniqueMessage).waitFor();
    await page.getByRole("button", { name: "Markeer afgehandeld" }).click();
    await page.getByRole("button", { name: "Afgehandeld", exact: true }).click();
    await page.getByText(uniqueMessage).waitFor();
  } finally {
    await context.close();
  }
});
