import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const BASE_URL = "http://127.0.0.1:8080";
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
      env: process.env,
      stdio: "ignore",
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
  devServer?.kill("SIGTERM");
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
    await opener.click();

    assert.equal(
      await page.evaluate(() =>
        document.activeElement?.getAttribute("aria-label"),
      ),
      "Winkelwagen sluiten",
    );
    await page.keyboard.press("Escape");
    assert.equal(
      await opener.evaluate((element) => element === document.activeElement),
      true,
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
    await opener.click();

    assert.equal(
      await page.evaluate(() => document.activeElement?.getAttribute("name")),
      "name",
    );
    await page.keyboard.press("Escape");
    assert.equal(
      await opener.evaluate((element) => element === document.activeElement),
      true,
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
    await page.getByRole("button", { name: "Veilig afrekenen" }).waitFor({
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

test("demo checkout completes without leaving the cart", async () => {
  const { context, page } = await newPage();
  try {
    await page.goto(`${BASE_URL}/product/semaglutide-4mg-pen`, {
      waitUntil: "networkidle",
    });
    await page
      .getByRole("button", { name: /^In winkelwagen/ })
      .first()
      .click();
    await page.getByRole("button", { name: "Veilig afrekenen" }).click();
    await page.getByText("Demo-checkout").waitFor({ state: "visible" });
    await page
      .getByRole("dialog", { name: "Winkelwagen" })
      .waitFor({ state: "visible" });
  } finally {
    await context.close();
  }
});
