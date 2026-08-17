import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = "http://127.0.0.1:8080";
const OUT = "/workspace/screenshots";

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}`, fullPage: false });
  console.log("shot", name);
}

async function run(label, viewport) {
  const context = await browser.newContext({
    viewport,
    locale: "nl-NL",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await shot(page, `${label}-home.png`);

  const cookie = page.getByRole("button", { name: "Accepteren" });
  if (await cookie.isVisible().catch(() => false)) {
    await cookie.click();
    await page.waitForTimeout(200);
  }

  const catalogCta = page.getByRole("link", { name: /Bekijk 6 producten/i });
  if (await catalogCta.count()) {
    await catalogCta.click();
  } else {
    await page.goto(BASE + "/#producten", { waitUntil: "domcontentloaded" });
  }
  await page.waitForTimeout(500);
  await shot(page, `${label}-producten.png`);

  const sema = page.getByRole("tab", { name: "Semaglutide" });
  if (await sema.count()) {
    await sema.click();
    await page.waitForTimeout(300);
    const cards = page.locator("#producten article");
    const n = await cards.count();
    if (n !== 2) errors.push(`${label}: Semaglutide filter toonde ${n} kaarten`);
    await shot(page, `${label}-filter-sema.png`);
  }

  await page.goto(BASE + "/#faq", { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const stillTwo = await page.locator("#producten article").count();
  if (stillTwo !== 2) errors.push(`${label}: FAQ reset filter (${stillTwo} kaarten)`);

  await page.goto(BASE + "/product/semaglutide-2mg", { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await shot(page, `${label}-pdp-vial.png`);

  const plus = page.getByRole("button", { name: "Aantal verhogen" });
  if (await plus.count()) {
    await plus.click();
    await plus.click();
  }
  const syringes = page.getByRole("radio", { name: /insulinespuiten/i });
  if (await syringes.count()) await syringes.click();

  await page.getByRole("button", { name: /In winkelwagen/i }).first().click();
  await page.waitForTimeout(500);
  await shot(page, `${label}-cart.png`);

  const codeToggle = page.getByRole("button", { name: /kortingscode/i });
  if (await codeToggle.count()) {
    await codeToggle.click();
    await page.getByLabel("Kortingscode").fill("FOUT");
    await page.getByRole("button", { name: "Toepassen" }).click();
    await page.waitForTimeout(300);
    await page.getByLabel("Kortingscode").fill("VOLT10");
    await page.getByRole("button", { name: "Toepassen" }).click();
    await page.waitForTimeout(300);
    await shot(page, `${label}-cart-code.png`);
  }

  await page.getByRole("button", { name: "Winkelwagen sluiten" }).click();
  await page.goto(BASE + "/product/semaglutide-4mg-pen", { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await shot(page, `${label}-pdp-pen.png`);

  await context.close();
  return errors;
}

const all = [
  ...(await run("desktop", { width: 1280, height: 800 })),
  ...(await run("mobile", { width: 390, height: 844 })),
];

await browser.close();

if (all.length) {
  console.error("QA issues:\n" + all.join("\n"));
  process.exit(1);
}
console.log("QA ok");
