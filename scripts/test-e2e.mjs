import { chromium } from "playwright";

async function runE2ETests() {
  console.log("Starting E2E Tests on Desktop and Mobile...");
  const browser = await chromium.launch({ headless: true });

  // 1. Desktop Test (1280x800)
  console.log("\n--- Running Desktop Tests (1280x800) ---");
  const desktopContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const desktopPage = await desktopContext.newPage();
  const consoleErrors = [];
  desktopPage.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await desktopPage.goto("http://127.0.0.1:8080/", { waitUntil: "networkidle" });
  console.log("Desktop Home Title:", await desktopPage.title());

  // Check category filter navigation & compound jump
  const semaLink = desktopPage.locator('nav[aria-label="Hoofdmenu"] a[href="/#semaglutide"]');
  await semaLink.click();
  await desktopPage.waitForTimeout(600);
  console.log("Hash after clicking Semaglutide:", await desktopPage.evaluate(() => window.location.hash));

  // Check product card and click to PDP
  const firstProductLink = desktopPage.locator('a[href^="/product/"]').first();
  await firstProductLink.click();
  await desktopPage.waitForURL(/\/product\//);
  console.log("Navigated to PDP:", desktopPage.url());

  // Test pack selector extra's and quantity
  const qtyPlus = desktopPage.locator('button[aria-label="Aantal verhogen"]');
  if (await qtyPlus.isVisible()) {
    await qtyPlus.click();
    await qtyPlus.click(); // qty = 3
    console.log("Increased quantity on PDP");
  }

  // Add to cart
  const addToCartBtn = desktopPage.locator('button:has-text("In winkelwagen")').first();
  await addToCartBtn.click();
  await desktopPage.waitForTimeout(500);

  // Verify Cart Drawer is open
  const cartDrawer = desktopPage.locator('div[role="dialog"][aria-label="Winkelwagen"]');
  const isCartVisible = await cartDrawer.isVisible();
  console.log("Cart Drawer open after add:", isCartVisible);

  // Test discount code in Cart
  const codeToggle = desktopPage.locator('button:has-text("Heb je een kortingscode?")');
  if (await codeToggle.isVisible()) {
    await codeToggle.click();
    const codeInput = desktopPage.locator('input[placeholder="Code"]');
    await codeInput.fill("VOLT10");
    const applyBtn = desktopPage.locator('button:has-text("Toepassen")');
    await applyBtn.click();
    await desktopPage.waitForTimeout(500);
    console.log("Applied discount code VOLT10 in Cart");
  }

  // Take Desktop Screenshot
  await desktopPage.screenshot({ path: "/workspace/screenshots/desktop-test.png", fullPage: true });
  console.log("Desktop screenshot saved to /workspace/screenshots/desktop-test.png");

  await desktopContext.close();

  // 2. Mobile Test (iPhone 14 / modern mobile ~390x844)
  console.log("\n--- Running Mobile Tests (390x844) ---");
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    isMobile: true,
    hasTouch: true,
  });
  const mobilePage = await mobileContext.newPage();
  mobilePage.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await mobilePage.goto("http://127.0.0.1:8080/", { waitUntil: "networkidle" });
  console.log("Mobile Home loaded");

  // Accept Cookie banner
  const acceptCookie = mobilePage.locator('button:has-text("Accepteren")');
  if (await acceptCookie.isVisible()) {
    await acceptCookie.click();
    console.log("Accepted cookie banner on mobile");
    await mobilePage.waitForTimeout(300);
  }

  // Mobile menu toggle test
  const menuBtn = mobilePage.locator('button[aria-label="Menu openen"]');
  if (await menuBtn.isVisible()) {
    await menuBtn.click();
    console.log("Opened mobile navigation menu");
    const closeBtn = mobilePage.locator('button[aria-label="Menu sluiten"]');
    console.log("Close menu button visible:", await closeBtn.isVisible());
    // Click Tirzepatide in mobile menu
    const tirzLink = mobilePage.locator('#mobile-nav a[href="/#tirzepatide"]');
    await tirzLink.click();
    await mobilePage.waitForTimeout(500);
    console.log("Mobile Hash after click:", await mobilePage.evaluate(() => window.location.hash));
  }

  // Scroll down to test Mobile Sticky Bar
  await mobilePage.evaluate(() => window.scrollTo(0, 1000));
  await mobilePage.waitForTimeout(600);

  // Go to PDP on mobile
  await mobilePage.goto("http://127.0.0.1:8080/product/semaglutide-4mg-pen", { waitUntil: "networkidle" });
  console.log("Mobile PDP loaded:", mobilePage.url());

  // Check Mobile Sticky Bar on PDP
  await mobilePage.evaluate(() => window.scrollTo(0, 800));
  await mobilePage.waitForTimeout(600);

  const stickyKopen = mobilePage.locator('div.fixed button:has-text("Kopen")');
  if (await stickyKopen.isVisible()) {
    console.log("Mobile sticky Kopen button is visible");
    await stickyKopen.click();
    await mobilePage.waitForTimeout(500);
    const cartOpenMobile = await mobilePage.locator('div[role="dialog"][aria-label="Winkelwagen"]').isVisible();
    console.log("Cart Drawer open after sticky Kopen tap:", cartOpenMobile);
  }

  // Take Mobile Screenshot
  await mobilePage.screenshot({ path: "/workspace/screenshots/mobile-test.png", fullPage: true });
  console.log("Mobile screenshot saved to /workspace/screenshots/mobile-test.png");

  await mobileContext.close();
  await browser.close();

  if (consoleErrors.length > 0) {
    console.error("Console Errors during testing:", consoleErrors);
    process.exit(1);
  } else {
    console.log("\nAll E2E checks passed with 0 console errors!");
  }
}

runE2ETests().catch((err) => {
  console.error("E2E Test Failed:", err);
  process.exit(1);
});
