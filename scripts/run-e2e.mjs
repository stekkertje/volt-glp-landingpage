import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

mkdirSync("/workspace/screenshots", { recursive: true });

async function runE2E() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    // 1. Mobile view test (~390px iPhone viewport)
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });
    const mobilePage = await mobileContext.newPage();

    console.log("Testing mobile homepage...");
    await mobilePage.goto("http://127.0.0.1:8080/", { waitUntil: "networkidle" });
    await mobilePage.screenshot({ path: "/workspace/screenshots/mobile-home-top.png" });

    // Accept cookies on mobile
    const cookieAcceptBtn = mobilePage.locator("button:has-text('Accepteren')");
    if (await cookieAcceptBtn.isVisible()) {
      await cookieAcceptBtn.click();
      await mobilePage.waitForTimeout(300);
    }
    await mobilePage.screenshot({ path: "/workspace/screenshots/mobile-home-after-cookie.png" });

    // Scroll down to see products and sticky bar
    await mobilePage.evaluate(() => window.scrollTo(0, 700));
    await mobilePage.waitForTimeout(500);
    await mobilePage.screenshot({ path: "/workspace/screenshots/mobile-sticky-bar.png" });

    // Test PDP on mobile
    console.log("Testing mobile PDP (semaglutide-4mg-pen)...");
    await mobilePage.goto("http://127.0.0.1:8080/product/semaglutide-4mg-pen", { waitUntil: "networkidle" });
    await mobilePage.screenshot({ path: "/workspace/screenshots/mobile-pdp-top.png" });

    // Scroll to buy box and change qty
    const plusBtn = mobilePage.locator("button[aria-label='Aantal verhogen']");
    await plusBtn.click(); // qty = 2
    await plusBtn.click(); // qty = 3
    await plusBtn.click(); // qty = 4
    await plusBtn.click(); // qty = 5 (triggers 10% stack discount)
    await mobilePage.waitForTimeout(300);
    await mobilePage.screenshot({ path: "/workspace/screenshots/mobile-pdp-qty5-stack.png" });

    // Add to cart
    const addToCartBtn = mobilePage.locator("button:has-text('In winkelwagen')").first();
    await addToCartBtn.click();
    await mobilePage.waitForTimeout(600);
    await mobilePage.screenshot({ path: "/workspace/screenshots/mobile-cart-drawer.png" });

    // Apply coupon code VOLT10 in drawer
    const promoToggle = mobilePage.locator("button:has-text('Heb je een kortingscode?')");
    if (await promoToggle.isVisible()) {
      await promoToggle.click();
      await mobilePage.fill("input[placeholder='Code']", "VOLT10");
      await mobilePage.click("button:has-text('Toepassen')");
      await mobilePage.waitForTimeout(500);
      await mobilePage.screenshot({ path: "/workspace/screenshots/mobile-cart-discount-applied.png" });
    }

    // Close drawer
    await mobilePage.click("button[aria-label='Winkelwagen sluiten']");
    await mobilePage.waitForTimeout(300);

    // 2. Desktop PDP test with Vial options
    const desktopContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const desktopPage = await desktopContext.newPage();

    console.log("Testing desktop PDP with vial options (retatrutide-10mg)...");
    await desktopPage.goto("http://127.0.0.1:8080/product/retatrutide-10mg", { waitUntil: "networkidle" });
    await desktopPage.screenshot({ path: "/workspace/screenshots/desktop-vial-pdp.png" });

    // Select syringes option
    const syringesRadio = desktopPage.locator("button[role='radio']").nth(1);
    await syringesRadio.click();
    await desktopPage.waitForTimeout(300);
    await desktopPage.screenshot({ path: "/workspace/screenshots/desktop-vial-syringes-selected.png" });

    // Add to cart on desktop
    await desktopPage.click("button:has-text('In winkelwagen')");
    await desktopPage.waitForTimeout(500);
    await desktopPage.screenshot({ path: "/workspace/screenshots/desktop-cart-drawer.png" });

    console.log("E2E tests completed successfully!");
  } finally {
    await browser.close();
  }
}

runE2E().catch((err) => {
  console.error("E2E error:", err);
  process.exit(1);
});
