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

async function withPage(viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ baseURL, viewport });
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("volt-cookie-consent", "accepted");
  });
  return { context, page };
}

run("PDP title keeps the product name after a cart update", async () => {
  const { context, page } = await withPage();
  await page.goto("/product/semaglutide-4mg-pen");
  await assert.doesNotReject(() => page.waitForLoadState("networkidle"));
  assert.match(await page.title(), /Semaglutide 4mg/);

  await page.getByRole("button", { name: /In winkelwagen/ }).first().click();
  await page.getByRole("button", { name: "Winkelwagen sluiten" }).click();
  assert.match(await page.title(), /^\(1\) Semaglutide 4mg/);
  await context.close();
});

run("a product card always adds one item after changing PDP quantity", async () => {
  const { context, page } = await withPage();
  await page.goto("/product/semaglutide-4mg-pen");
  await page.getByRole("button", { name: "Aantal verhogen" }).click();
  await page.getByRole("button", { name: "Aantal verhogen" }).click();
  await page.getByRole("button", { name: "Aantal verhogen" }).click();
  await page.getByRole("button", { name: "Aantal verhogen" }).click();

  const related = page.locator("section").filter({ hasText: "Andere sterkte / vorm" });
  await related.getByRole("button", { name: "In winkelwagen" }).first().click();
  const line = page.locator('[role="dialog"]').locator("div").filter({ hasText: "Semaglutide 2mg" });
  await assert.doesNotReject(() => line.getByText("1", { exact: true }).first().waitFor());
  await context.close();
});

run("an invalid retry preserves and visibly restores an active discount code", async () => {
  const { context, page } = await withPage();
  await page.goto("/");
  await page.getByRole("button", { name: "In winkelwagen" }).first().click();
  await page.getByRole("button", { name: "Heb je een kortingscode?" }).click();
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
});

run("related PDP cards only show the same compound", async () => {
  const { context, page } = await withPage();
  await page.goto("/product/semaglutide-4mg-pen");
  const related = page.locator("section").filter({ hasText: "Andere sterkte / vorm" });
  const labels = await related.locator("article > div > p").first().allTextContents();
  assert.ok(labels.length > 0);
  assert.ok(labels.every((label) => label.includes("Semaglutide")));
  await context.close();
});

run("cart and contact dialogs move focus inside on open", async () => {
  const { context, page } = await withPage({ width: 390, height: 844 });
  await page.goto("/");

  await page.getByRole("button", { name: "Winkelwagen openen" }).first().click();
  assert.equal(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null), true);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Menu openen" }).click();
  await page.getByRole("button", { name: "Contact" }).click();
  assert.equal(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null), true);
  await context.close();
});

run("shipping promises use the workday wording", async () => {
  const { context, page } = await withPage();
  await page.goto("/product/semaglutide-4mg-pen");
  await page.getByText(/volgende werkdag verzonden/i).first().waitFor();
  assert.equal(await page.getByText(/morgen verzonden/i).count(), 0);
  await context.close();
});
