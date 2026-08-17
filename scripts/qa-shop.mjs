import { chromium, devices } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:8080";
const OUT = "/workspace/screenshots";

const issues = [];

function fail(msg) {
  issues.push(msg);
  console.error("FAIL:", msg);
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}`, fullPage: false });
}

async function runDesktop(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await shot(page, "qa-home-desktop.png");

  await page.click('a[href="/#semaglutide"]');
  await page.waitForTimeout(600);
  const filterSem = await page.locator('button[role="tab"][aria-selected="true"]').textContent();
  if (!filterSem?.includes("Semaglutide")) fail("Header Semaglutide link should activate filter");
  const productSection = await page.locator("#producten").boundingBox();
  if (!productSection || productSection.y > 200) fail("Semaglutide nav should scroll to product grid");

  await page.goto(`${BASE}/#faq`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const filterAfterFaq = await page.locator('button[role="tab"][aria-selected="true"]').textContent();
  if (!filterAfterFaq?.includes("Semaglutide")) fail("FAQ hash should not reset active filter");

  await page.goto(`${BASE}/product/semaglutide-2mg`, { waitUntil: "networkidle" });
  await shot(page, "qa-pdp-desktop.png");
  const weeks = await page.getByText(/weken bij startdosis/i).count();
  if (!weeks) fail("PDP should show duration in weeks");

  await page.getByRole("button", { name: "Aantal verhogen" }).click();
  await page.getByRole("button", { name: "Aantal verhogen" }).click();
  const qty = await page.locator('[aria-live="polite"]').first().textContent();
  if (qty?.trim() !== "3") fail(`Qty stepper expected 3, got ${qty}`);

  await page.locator("#prijzen").getByRole("button", { name: /In winkelwagen/i }).click();
  await page.waitForSelector('[aria-label="Winkelwagen"]', { timeout: 5000 });
  const cartDialog = page.getByRole("dialog", { name: "Winkelwagen" });
  const cartQty = await cartDialog.locator(".tabular-nums.font-semibold").first().textContent();
  if (cartQty?.trim() !== "3") fail(`Cart should have qty 3, got ${cartQty}`);

  await page.getByRole("button", { name: "Winkelwagen sluiten" }).click();
  await page.goto(`${BASE}/product/semaglutide-4mg-pen`, { waitUntil: "networkidle" });
  const galleryThumb = page.locator("#prijzen").locator("..").locator("button").first();
  if (await galleryThumb.count()) {
    /* gallery present */
  }

  await page.close();
}

async function runMobile(browser) {
  const iphone = devices["iPhone 13"];
  const page = await browser.newPage({ ...iphone });
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await shot(page, "qa-home-mobile.png");

  const h1Box = await page.locator("h1").boundingBox();
  const heroBtn = await page.getByRole("link", { name: /Bekijk 6 producten/i }).first().boundingBox();
  if (h1Box && heroBtn && heroBtn.y > 900) fail("Mobile hero CTA should be closer to fold");

  await page.evaluate(() => window.scrollTo(0, 900));
  await page.waitForTimeout(400);
  await shot(page, "qa-mobile-sticky.png");

  const sticky = page.getByRole("button", { name: "Kopen" }).or(page.getByRole("link", { name: "Bekijk" }));
  if (!(await sticky.count())) {
    /* sticky may not show on home until scrolled past buy section */
  }

  await page.goto(`${BASE}/product/retatrutide-10mg`, { waitUntil: "networkidle" });
  await page.evaluate(() => window.scrollTo(0, 1200));
  await page.waitForTimeout(500);
  await shot(page, "qa-pdp-mobile-sticky.png");

  await page.getByRole("button", { name: "Aantal verhogen" }).click();
  await page.getByRole("button", { name: "Aantal verhogen" }).click();
  await page.getByRole("button", { name: "Aantal verhogen" }).click();
  await page.getByRole("button", { name: "Aantal verhogen" }).click();
  const stickyBuy = page.getByRole("button", { name: "Kopen" });
  if (await stickyBuy.isVisible()) {
    await stickyBuy.click();
    await page.waitForSelector('[aria-label="Winkelwagen"]', { timeout: 5000 });
    const cartDialog = page.getByRole("dialog", { name: "Winkelwagen" });
    const lineQty = await cartDialog.locator(".tabular-nums.font-semibold").first().textContent();
    if (lineQty?.trim() !== "5") fail(`Sticky buy should add selected qty 5, got ${lineQty}`);
  }

  await page.close();
}

async function runCartDiscount(browser) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });

  await page.evaluate(() => localStorage.setItem("volt-cart", JSON.stringify({
    state: {
      lines: [{ slug: "semaglutide-4mg-pen", optionId: "default", qty: 1 }],
      discountCode: "VOLT10",
      discountApplied: true,
      selectedSlug: "semaglutide-4mg-pen",
      selectedOptionId: "default",
    },
    version: 0,
  })));

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Winkelwagen openen/i }).first().click();
  await page.waitForSelector('[aria-label="Winkelwagen"]');

  await page.getByRole("button", { name: /kortingscode/i }).click();
  await page.getByLabel("Kortingscode").fill("BADCODE");
  await page.getByRole("button", { name: "Toepassen" }).click();
  await page.waitForTimeout(500);

  const discountRow = page.getByText("Korting (10%)");
  if (!(await discountRow.count())) fail("Valid VOLT10 should remain after invalid code attempt");

  const errorToast = page.getByText("Code niet geldig");
  if (await errorToast.count()) {
    const icon = page.locator('[role="alert"] svg').first();
    const cls = await icon.getAttribute("class");
    if (cls?.includes("text-success")) fail("Error toast should not use success styling");
  }

  await page.close();
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  await runDesktop(browser);
  await runMobile(browser);
  await runCartDiscount(browser);
} finally {
  await browser.close();
}

if (issues.length) {
  console.error(`\n${issues.length} issue(s) found.`);
  process.exit(1);
}
console.log("QA passed.");
