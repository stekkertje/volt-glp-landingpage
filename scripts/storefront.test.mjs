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
    localStorage.clear();
    localStorage.setItem("volt-cookie-consent", "accepted");
  });
  const page = await context.newPage();
  return { context, page };
}

async function cartState(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("volt-cart") || "{}").state);
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
    await page.goto(`${BASE_URL}/product/semaglutide-4mg-pen`, { waitUntil: "networkidle" });
    const increase = page.getByRole("button", { name: "Aantal verhogen" });
    for (let i = 0; i < 4; i += 1) await increase.click();

    const related = page.locator("section").filter({ hasText: "Andere sterkte / vorm" });
    await related.getByRole("button", { name: "In winkelwagen" }).first().click();

    const state = await cartState(page);
    assert.deepEqual(state.lines, [
      { slug: "semaglutide-2mg", optionId: "none", qty: 1 },
    ]);
  } finally {
    await context.close();
  }
});

test("an invalid code does not replace an active VOLT10 discount", async () => {
  const { context, page } = await newPage();
  try {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.locator("#producten article").first().getByRole("button", {
      name: "In winkelwagen",
    }).click();
    await page.getByRole("button", { name: "Heb je een kortingscode?" }).click();

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
    await page.goto(`${BASE_URL}/product/semaglutide-4mg-pen`, { waitUntil: "networkidle" });
    const related = page.locator("section").filter({ hasText: "Andere sterkte / vorm" });
    await related.getByRole("button", { name: "In winkelwagen" }).first().click();
    await page.getByRole("button", { name: "Winkelwagen sluiten" }).click();
    await related.scrollIntoViewIfNeeded();
    await page.waitForTimeout(350);

    const sticky = page.locator("div.fixed").filter({
      has: page.getByRole("button", { name: "Kopen" }),
    });
    await sticky.waitFor({ state: "visible" });
    assert.match(await sticky.innerText(), /Semaglutide 4mg · Pen/);
  } finally {
    await context.close();
  }
});

test("the PDP keeps its product-specific document title", async () => {
  const { context, page } = await newPage();
  try {
    await page.goto(`${BASE_URL}/product/semaglutide-2mg`, { waitUntil: "networkidle" });
    assert.equal(await page.title(), "Semaglutide 2mg kopen | VOLT");

    await page.getByRole("button", { name: /^In winkelwagen/ }).first().click();
    assert.equal(await page.title(), "(1) Semaglutide 2mg kopen | VOLT");
  } finally {
    await context.close();
  }
});
