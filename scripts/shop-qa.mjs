#!/usr/bin/env node
/**
 * Shop flow QA: home, category hashes, PDP, cart, discount, mobile sticky.
 * Writes screenshots under /workspace/screenshots/.
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = process.argv[2] || "http://127.0.0.1:8080";
const outDir = "/workspace/screenshots";
mkdirSync(outDir, { recursive: true });

const errors = [];
const notes = [];

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

async function shot(page, name) {
  await page.screenshot({ path: `${outDir}/${name}`, fullPage: false });
}

try {
  const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  desktop.on("pageerror", (err) => errors.push(`desktop: ${err.message}`));

  await desktop.goto(`${base}/`, { waitUntil: "networkidle", timeout: 45000 });
  await desktop.waitForTimeout(600);
  const title = await desktop.title();
  if (!/VOLT/i.test(title)) errors.push(`home title unexpected: ${title}`);
  await shot(desktop, "qa-home-desktop.png");

  const h1 = await desktop.locator("h1").first().innerText();
  if (!/GLP-1/i.test(h1)) errors.push(`home h1 unexpected: ${h1}`);

  await desktop.locator('a[href="#producten"]').first().click();
  await desktop.waitForTimeout(500);
  const gridCount = await desktop.locator("#producten article").count();
  if (gridCount !== 6) errors.push(`unfiltered grid expected 6, got ${gridCount}`);

  await desktop.goto(`${base}/#semaglutide`, { waitUntil: "networkidle" });
  await desktop.waitForTimeout(700);
  const semaCount = await desktop.locator("#producten article").count();
  if (semaCount !== 2) errors.push(`semaglutide filter expected 2, got ${semaCount}`);
  await shot(desktop, "qa-filter-semaglutide.png");

  await desktop.goto(`${base}/#faq`, { waitUntil: "domcontentloaded" });
  await desktop.waitForTimeout(400);
  const stillSema = await desktop.locator("#producten article").count();
  if (stillSema !== 2) errors.push(`faq hash reset filter, count=${stillSema}`);

  await desktop.goto(`${base}/product/semaglutide-4mg-pen`, { waitUntil: "networkidle" });
  await desktop.waitForTimeout(500);
  const pdpH1 = await desktop.locator("h1").first().innerText();
  if (!/Semaglutide 4mg/i.test(pdpH1)) errors.push(`pdp h1 unexpected: ${pdpH1}`);
  await shot(desktop, "qa-pdp-desktop.png");

  const plus = desktop.getByRole("button", { name: "Aantal verhogen" });
  await plus.click();
  await plus.click();
  await desktop.getByRole("button", { name: /In winkelwagen/ }).click();
  await desktop.waitForTimeout(400);
  const cartTitle = await desktop.getByRole("dialog", { name: "Winkelwagen" }).innerText();
  if (!/3/.test(cartTitle) && !/\(3\)/.test(cartTitle)) {
    notes.push(`cart header text: ${cartTitle.slice(0, 120)}`);
  }
  const qtyText = await desktop.locator('[aria-label="Winkelwagen"] >> text=/^3$/').count();
  if (qtyText === 0) {
    const body = await desktop.getByRole("dialog", { name: "Winkelwagen" }).innerText();
    if (!/\b3\b/.test(body)) errors.push("expected qty 3 in cart after stepper 3");
  }

  await desktop.getByRole("button", { name: /kortingscode/i }).click();
  await desktop.getByLabel("Kortingscode").fill("FOUT");
  await desktop.getByRole("button", { name: "Toepassen" }).click();
  await desktop.waitForTimeout(300);
  const invalid = await desktop.getByText("Code niet geldig").count();
  if (invalid === 0) errors.push("invalid code toast missing");

  await desktop.getByLabel("Kortingscode").fill("VOLT10");
  await desktop.getByRole("button", { name: "Toepassen" }).click();
  await desktop.waitForTimeout(300);
  const applied = await desktop.getByText(/VOLT10 actief|Kortingscode toegepast/).count();
  if (applied === 0) errors.push("VOLT10 success missing");
  await shot(desktop, "qa-cart-desktop.png");

  await desktop.getByLabel("Kortingscode").fill("FOUT");
  await desktop.getByRole("button", { name: "Toepassen" }).click();
  await desktop.waitForTimeout(300);
  const stillApplied = await desktop.getByText(/VOLT10 actief|Korting \(10%\)/).count();
  if (stillApplied === 0) errors.push("invalid code wiped VOLT10");

  await desktop.getByRole("button", { name: "Achtergrond sluiten" }).click();

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  mobile.on("pageerror", (err) => errors.push(`mobile: ${err.message}`));
  await mobile.addInitScript(() => localStorage.removeItem("volt-cookie-consent"));
  await mobile.goto(`${base}/`, { waitUntil: "networkidle" });
  await mobile.waitForTimeout(600);
  await shot(mobile, "qa-home-mobile.png");

  const cookie = mobile.getByRole("button", { name: "Accepteren" });
  if ((await cookie.count()) > 0) {
    const stickyBefore = await mobile.getByRole("button", { name: "Kopen" }).count();
    notes.push(`sticky kopen while cookie visible: ${stickyBefore}`);
    await cookie.click();
    await mobile.waitForTimeout(200);
  }

  const heroCta = await mobile.getByRole("link", { name: /Bekijk 6 producten/ }).count();
  if (heroCta === 0) errors.push("mobile hero missing primary CTA");

  await mobile.goto(`${base}/product/retatrutide-10mg`, { waitUntil: "networkidle" });
  await mobile.waitForTimeout(500);
  await shot(mobile, "qa-pdp-mobile.png");
  const weeks = await mobile.getByText(/weken bij startdosis/).count();
  if (weeks === 0) errors.push("pdp missing duration line");
  const syringes = await mobile.getByText(/10 insulinespuiten/).count();
  if (syringes === 0) errors.push("pdp missing syringe option");

  await mobile.evaluate(() => window.scrollTo(0, 1800));
  await mobile.waitForTimeout(400);
  const stickyBuy = mobile.getByRole("button", { name: "Kopen" });
  if ((await stickyBuy.count()) === 0) errors.push("mobile sticky Kopen missing after scroll");
  else {
    const box = await stickyBuy.boundingBox();
    if (box && box.y + box.height > 844) errors.push("sticky Kopen below viewport");
    await shot(mobile, "qa-sticky-mobile.png");
  }

  await mobile.goto(`${base}/product/does-not-exist`, { waitUntil: "networkidle" });
  const missing = await mobile.getByText("Product niet gevonden").count();
  if (missing === 0) errors.push("404 product page missing");

  console.log(JSON.stringify({ ok: errors.length === 0, errors, notes }, null, 2));
  if (errors.length) process.exit(1);
} finally {
  await browser.close();
}
