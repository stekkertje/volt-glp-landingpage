import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

const baseURL = process.env.E2E_BASE_URL;
const run = baseURL ? test : test.skip;
let browser;

before(async () => {
  if (baseURL) browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
});

async function withPage(
  viewport = { width: 1280, height: 900 },
  { acceptCookies = true } = {},
) {
  const context = await browser.newContext({ baseURL, viewport });
  const page = await context.newPage();
  await page.addInitScript((shouldAcceptCookies) => {
    if (!sessionStorage.getItem("volt-e2e-initialized")) {
      localStorage.clear();
      sessionStorage.setItem("volt-e2e-initialized", "true");
    }
    if (shouldAcceptCookies) {
      localStorage.setItem("volt-cookie-consent", "accepted");
    }
  }, acceptCookies);
  return { context, page };
}

async function go(page, path) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

run("PDP title keeps the product name after a cart update", async () => {
  const { context, page } = await withPage();
  await go(page, "/product/semaglutide-4mg-pen");
  assert.match(await page.title(), /Semaglutide 4mg/);

  await page
    .getByRole("button", { name: /In winkelwagen/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Winkelwagen sluiten" }).click();
  assert.match(await page.title(), /^\(1\) Semaglutide 4mg/);
  await context.close();
});

run(
  "a product card always adds one item after changing PDP quantity",
  async () => {
    const { context, page } = await withPage();
    await go(page, "/product/semaglutide-4mg-pen");
    await page.getByRole("button", { name: "Aantal verhogen" }).click();
    await page.getByRole("button", { name: "Aantal verhogen" }).click();
    await page.getByRole("button", { name: "Aantal verhogen" }).click();
    await page.getByRole("button", { name: "Aantal verhogen" }).click();

    const related = page
      .locator("section")
      .filter({ hasText: "Andere sterkte / vorm" });
    await related
      .getByRole("button", { name: "In winkelwagen" })
      .first()
      .click();
    await page.getByRole("heading", { name: /Winkelwagen\s*\(1\)/ }).waitFor();
    await context.close();
  },
);

run(
  "an invalid retry preserves and visibly restores an active discount code",
  async () => {
    const { context, page } = await withPage();
    await go(page, "/");
    await page
      .getByRole("button", { name: "In winkelwagen", exact: true })
      .first()
      .click();
    await page
      .getByRole("button", { name: "Heb je een kortingscode?" })
      .click();
    const code = page.getByRole("textbox", { name: "Kortingscode" });
    await code.fill("VOLT10");
    await page.getByRole("button", { name: "Toepassen" }).click();
    await page.getByText("Korting (10%)").waitFor();

    await code.fill("ONJUIST");
    await page.getByRole("button", { name: "Toepassen" }).click();
    await assert.doesNotReject(() => page.getByText("VOLT10 actief").waitFor());
    assert.equal(await code.inputValue(), "VOLT10");
    await page.getByText("Korting (10%)").waitFor();
    await context.close();
  },
);

run("related PDP cards only show the same compound", async () => {
  const { context, page } = await withPage();
  await go(page, "/product/semaglutide-4mg-pen");
  const related = page
    .locator("section")
    .filter({ hasText: "Andere sterkte / vorm" });
  const cards = await related.locator("article").allTextContents();
  assert.ok(cards.length > 0);
  assert.ok(cards.every((card) => card.includes("Semaglutide")));
  await context.close();
});

run("cart and contact dialogs move focus inside on open", async () => {
  const { context, page } = await withPage({ width: 390, height: 844 });
  await go(page, "/");

  await page
    .getByRole("button", { name: "Winkelwagen openen" })
    .first()
    .click();
  await page.waitForFunction(
    () => document.activeElement?.closest('[role="dialog"]') !== null,
  );
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Menu openen" }).click();
  await page
    .getByLabel("Mobiel menu")
    .getByRole("button", { name: "Contact", exact: true })
    .click();
  await page.waitForFunction(
    () => document.activeElement?.closest('[role="dialog"]') !== null,
  );
  await context.close();
});

run("shipping promises use the workday wording", async () => {
  const { context, page } = await withPage();
  await go(page, "/product/semaglutide-4mg-pen");
  await page
    .getByText(/volgende werkdag verzonden/i)
    .first()
    .waitFor();
  assert.equal(await page.getByText(/morgen verzonden/i).count(), 0);
  await context.close();
});

run(
  "all product routes, galleries, and the product 404 render correctly",
  async () => {
    const { context, page } = await withPage();
    const products = [
      ["semaglutide-2mg", "Semaglutide 2mg"],
      ["semaglutide-4mg-pen", "Semaglutide 4mg · Pen"],
      ["tirzepatide-10mg", "Tirzepatide 10mg"],
      ["tirzepatide-20mg-pen", "Tirzepatide 20mg · Pen"],
      ["retatrutide-10mg", "Retatrutide 10mg"],
      ["retatrutide-20mg-pen", "Retatrutide 20mg · Pen"],
    ];
    const failedImages = [];
    page.on("response", (response) => {
      if (
        response.request().resourceType() === "image" &&
        response.status() >= 400
      ) {
        failedImages.push(`${response.status()} ${response.url()}`);
      }
    });

    for (const [slug, name] of products) {
      await go(page, `/product/${slug}`);
      await page.getByRole("heading", { level: 1, name }).waitFor();
      assert.match(await page.title(), new RegExp(name.split(" · ")[0]));
    }
    assert.deepEqual(failedImages, []);

    await go(page, "/product/semaglutide-4mg-pen");
    const firstSource = await page
      .getByRole("img", { name: "Semaglutide 4mg pen voorkant" })
      .getAttribute("src");
    await page.getByRole("button", { name: "Afbeelding 2" }).click();
    assert.notEqual(
      await page
        .getByRole("img", { name: "Semaglutide 4mg pen inhoud" })
        .getAttribute("src"),
      firstSource,
    );

    const response = await page.goto("/product/bestaat-niet");
    assert.equal(response?.status(), 404);
    await page
      .getByRole("heading", { name: "Product niet gevonden" })
      .waitFor();
    await context.close();
  },
);

run(
  "desktop compound navigation filters and preserves the active selection",
  async () => {
    const { context, page } = await withPage();
    await go(page, "/");
    const nav = page.getByRole("navigation", { name: "Hoofdmenu" });

    for (const [label, hash] of [
      ["Semaglutide", "#semaglutide"],
      ["Tirzepatide", "#tirzepatide"],
      ["Retatrutide", "#retatrutide"],
    ]) {
      await nav.getByRole("link", { name: label, exact: true }).click();
      await page.getByText("2 producten", { exact: true }).waitFor();
      assert.equal(new URL(page.url()).hash, hash);
    }

    await nav.getByRole("link", { name: "Veelgestelde vragen" }).click();
    assert.equal(new URL(page.url()).hash, "#faq");
    await page.getByText("2 producten", { exact: true }).waitFor();

    await page
      .getByRole("contentinfo")
      .getByRole("link", { name: "Beoordelingen" })
      .click();
    assert.equal(new URL(page.url()).hash, "#beoordelingen");
    await page.getByText("2 producten", { exact: true }).waitFor();
    await context.close();
  },
);

run(
  "mobile first-visit chrome stays usable and sticky buy keeps PDP quantity",
  async () => {
    const { context, page } = await withPage(
      { width: 390, height: 844 },
      { acceptCookies: false },
    );
    await go(page, "/product/semaglutide-4mg-pen");
    const cookie = page.getByRole("region", { name: "Functionele opslag" });
    await cookie.waitFor();

    for (let i = 0; i < 4; i += 1) {
      await page.getByRole("button", { name: "Aantal verhogen" }).click();
    }
    await page
      .getByRole("heading", { name: "Waarom dit product" })
      .scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 400));
    const stickyBuy = page.getByRole("button", { name: "Kopen", exact: true });
    await stickyBuy.waitFor();

    const stickyBox = await stickyBuy.evaluate((element) =>
      element.closest(".fixed")?.getBoundingClientRect().toJSON(),
    );
    const cookieBox = await cookie.evaluate((element) =>
      element.getBoundingClientRect().toJSON(),
    );
    assert.ok(stickyBox && cookieBox);
    assert.ok(stickyBox.bottom <= cookieBox.top + 2);

    await stickyBuy.click();
    await page.getByRole("heading", { name: /Winkelwagen\s*\(5\)/ }).waitFor();
    await context.close();
  },
);

run("mobile menu closes on outside click and real scroll", async () => {
  const { context, page } = await withPage({ width: 390, height: 844 });
  await go(page, "/");
  const menu = page.getByLabel("Mobiel menu");

  await page.getByRole("button", { name: "Menu openen" }).click();
  await menu.waitFor();
  await page
    .locator("section.hero-grid")
    .click({ position: { x: 10, y: 500 } });
  await page.getByRole("button", { name: "Menu openen" }).waitFor();

  await page.getByRole("button", { name: "Menu openen" }).click();
  await page.waitForTimeout(550);
  await page.mouse.wheel(0, 300);
  await page.getByRole("button", { name: "Menu openen" }).waitFor();
  await context.close();
});

run(
  "footer contact flow validates, traps focus, restores focus, and submits",
  async () => {
    const { context, page } = await withPage();
    await go(page, "/");
    const trigger = page
      .getByRole("contentinfo")
      .getByRole("button", { name: "Contact", exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Contact" });
    await dialog.waitFor();

    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press("Tab");
      assert.equal(
        await page.evaluate(
          () => document.activeElement?.closest('[role="dialog"]') !== null,
        ),
        true,
      );
    }

    await dialog.getByRole("button", { name: "Verstuur bericht" }).click();
    for (const field of ["contact-name", "contact-email", "contact-message"]) {
      assert.equal(
        await page.locator(`#${field}`).getAttribute("aria-invalid"),
        "true",
      );
    }

    await page.keyboard.press("Escape");
    await page.waitForFunction(
      (element) => document.activeElement === element,
      await trigger.elementHandle(),
    );

    await trigger.click();
    await page.locator("#contact-name").fill("Sanne");
    await page.locator("#contact-email").fill("sanne@example.nl");
    await page
      .locator("#contact-message")
      .fill("Ik heb een vraag over de levering van mijn bestelling.");
    await page.getByRole("button", { name: "Verstuur bericht" }).click();
    await page.getByText("Bericht verstuurd").waitFor();
    await context.close();
  },
);

run("cart persists and applies both stack discount tiers", async () => {
  const { context, page } = await withPage();
  await go(page, "/");
  await page
    .getByRole("button", { name: "In winkelwagen", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Winkelwagen sluiten" }).click();
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page
    .getByRole("button", { name: "Winkelwagen openen, 1 product" })
    .first()
    .click();

  const increase = page.getByRole("button", {
    name: "Aantal verhogen in winkelwagen",
  });
  for (let i = 0; i < 4; i += 1) await increase.click();
  await page.getByText("Stapelkorting (10%)").waitFor();
  for (let i = 0; i < 5; i += 1) await increase.click();
  await page.getByText("Stapelkorting (20%)").waitFor();
  await page.getByText("Gratis verzending bereikt").waitFor();
  await context.close();
});

run(
  "home and PDP have no horizontal overflow at mobile and desktop widths",
  async () => {
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1440, height: 900 },
    ]) {
      const { context, page } = await withPage(viewport);
      for (const path of ["/", "/product/retatrutide-20mg-pen"]) {
        await go(page, path);
        assert.equal(
          await page.evaluate(
            () =>
              document.documentElement.scrollWidth <=
              document.documentElement.clientWidth,
          ),
          true,
        );
      }
      await context.close();
    }
  },
);
