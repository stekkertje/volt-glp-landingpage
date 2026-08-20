import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { createServer as createViteServer } from "vite";

const AUTH_SECRET = "account-browser-auth-secret-with-at-least-32-characters";
const ACCESS_SECRET =
  "account-browser-order-secret-with-at-least-32-characters";
const MAIL_ENVIRONMENT = {
  SMTP_HOST: "smtp.invalid.test",
  SMTP_PORT: "465",
  SMTP_SECURE: "true",
  SMTP_USERNAME: "info@example.test",
  SMTP_PASSWORD_BASE64: "",
  SMTP_PASSWORD: "account-browser-smtp-password",
  MAIL_FROM_ADDRESS: "info@example.test",
  MAIL_FROM_NAME: "VOLT Test",
  MAIL_OWNER_ADDRESS: "owner@example.test",
};

let addressApiServer;
let addressApiBaseUrl;
let baseUrl;
let browser;
let processMailOutbox;
let vite;
let viteCacheDir;
const deliveredMessages = [];

async function availablePort() {
  const server = createNetServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Geen vrije browsertestpoort beschikbaar.");
  }
  const port = address.port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // De server start nog.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Account-testserver werd niet tijdig klaar.");
}

async function flushOutbox() {
  await processMailOutbox({
    limit: 25,
    environment: MAIL_ENVIRONMENT,
    deliver: async (mail) => {
      deliveredMessages.push(mail);
      return { providerMessageId: `account-browser-${mail.id}` };
    },
  });
}

function urlsFromMessage(message) {
  return (message.textBody.match(/https?:\/\/\S+/g) ?? []).map((url) =>
    url.replace(/[),.;]+$/, ""),
  );
}

function onTestOrigin(url) {
  const parsed = new URL(url);
  return `${baseUrl}${parsed.pathname}${parsed.search}${parsed.hash}`;
}

async function waitForMailUrl(email, marker, minimumMatches = 1) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    await flushOutbox();
    const urls = deliveredMessages
      .filter((message) => message.to.toLowerCase() === email.toLowerCase())
      .flatMap(urlsFromMessage)
      .filter((url) => url.includes(marker));
    if (urls.length >= minimumMatches) return urls.at(-1);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const observed = deliveredMessages.map((message) => ({
    toMatches: message.to.toLowerCase() === email.toLowerCase(),
    subject: message.subject,
    paths: urlsFromMessage(message).map((url) => {
      try {
        return new URL(url).pathname;
      } catch {
        return "ongeldige-url";
      }
    }),
  }));
  throw new Error(
    `Testmail met link ${marker} werd niet klaargezet: ${JSON.stringify(observed)}.`,
  );
}

before(async () => {
  addressApiServer = createHttpServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        data: {
          street: "Teststraat",
          number: url.searchParams.get("number") ?? "12",
          numberAddition: url.searchParams.get("numberAddition") ?? "A",
          postalcode: "1234AB",
          city: "Utrecht",
        },
      }),
    );
  });
  await new Promise((resolve, reject) => {
    addressApiServer.once("error", reject);
    addressApiServer.listen(0, "127.0.0.1", resolve);
  });
  const addressApiAddress = addressApiServer.address();
  if (!addressApiAddress || typeof addressApiAddress === "string") {
    throw new Error("Geen adres-API-testpoort beschikbaar.");
  }
  addressApiBaseUrl = `http://127.0.0.1:${addressApiAddress.port}`;

  Object.assign(process.env, {
    DATABASE_URL: "",
    DATABASE_URL_UNPOOLED: "",
    MIGRATION_DATABASE_URL: "",
    NEON_API_KEY: "",
    VERCEL: "",
    NETLIFY: "",
    REQUIRE_DATABASE: "",
    PGLITE_PREVIEW: "",
    NODE_ENV: "test",
    npm_lifecycle_event: "test",
    VITE_AUTH_ENABLED: "true",
    VITE_OAUTH_ENABLED: "true",
    GROK_AUTH_CLIENT_ID: "account-browser-oauth-client",
    GROK_AUTH_CLIENT_SECRET: "account-browser-oauth-client-secret",
    BETTER_AUTH_URL: "",
    BETTER_AUTH_SECRET: AUTH_SECRET,
    ORDER_ACCESS_TOKEN_SECRET: ACCESS_SECRET,
    ADDRESS_VALIDATION_TOKEN_SECRET:
      "account-browser-address-secret-with-at-least-32-characters",
    APICHECK_API_KEY: "account-browser-test-key",
    APICHECK_BASE_URL: addressApiBaseUrl,
    ...MAIL_ENVIRONMENT,
  });

  const port = await availablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  viteCacheDir = await mkdtemp(join(tmpdir(), "volt-account-browser-vite-"));
  vite = await createViteServer({
    cacheDir: viteCacheDir,
    logLevel: "silent",
    server: { host: "127.0.0.1", port, strictPort: true },
  });
  await vite.listen();
  await waitForServer();
  ({ processMailOutbox } = await vite.ssrLoadModule(
    "/src/lib/server/mail/worker.server.ts",
  ));
  browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
});

after(async () => {
  try {
    await browser?.close();
  } finally {
    await vite?.close();
    if (addressApiServer?.listening) {
      await new Promise((resolve) => addressApiServer.close(() => resolve()));
    }
    if (viteCacheDir) await rm(viteCacheDir, { recursive: true, force: true });
  }
});

test("klant doorloopt registratie, herstel, login, claimlink en mobiel account", async () => {
  const email = `account-browser-${randomUUID()}@example.test`;
  const unknownEmail = `onbekend-${randomUUID()}@example.test`;
  const firstPassword = "Eerste-sterke-code-2026";
  const resetPassword = "Tweede-sterke-code-2026";
  const finalPassword = "Derde-sterke-code-2026";
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await context.addInitScript(() => {
    localStorage.setItem("volt-cookie-consent", "accepted");
  });
  const page = await context.newPage();

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    const guestOrder = await page.evaluate(async (customerEmail) => {
      const [{ createOrder }, { validateCheckoutAddress }] = await Promise.all([
        import("/src/lib/server/orders.ts"),
        import("/src/lib/server/address-validation.ts"),
      ]);
      const address = {
        street: "Teststraat",
        houseNumber: "12 A",
        postcode: "1234 AB",
        city: "Utrecht",
        country: "NL",
      };
      const checked = await validateCheckoutAddress({ data: address });
      if (!checked.validationToken) throw new Error("Adresbewijs ontbreekt.");
      return createOrder({
        data: {
          name: "Mobiele Accountklant",
          email: customerEmail,
          phone: "0612345678",
          ...address,
          addressValidationToken: checked.validationToken,
          note: "Eerdere gastbestelling voor de accounttest.",
          lines: [{ slug: "semaglutide-4mg-pen", optionId: "default", qty: 1 }],
          idempotencyKey: crypto.randomUUID(),
        },
      });
    }, email);

    let resolveOAuthRequest;
    const oauthRequest = new Promise((resolve) => {
      resolveOAuthRequest = resolve;
    });
    await page.route("**/api/auth/sign-in/oauth2", async (route) => {
      const serverResponse = await route.fetch();
      resolveOAuthRequest({
        request: route.request().postDataJSON(),
        status: serverResponse.status(),
        response: await serverResponse.json(),
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ url: null, redirect: false }),
      });
    });
    await page.goto(`${baseUrl}/login?redirect=/admin`, {
      waitUntil: "networkidle",
    });
    await page.getByRole("button", { name: "Doorgaan met Google" }).waitFor();
    await page.getByRole("button", { name: "Doorgaan met X" }).waitFor();
    await page.getByLabel("E-mailadres").waitFor();
    await page.getByRole("button", { name: "Doorgaan met Google" }).click();
    const configuredOAuth = await oauthRequest;
    assert.deepEqual(configuredOAuth.request, {
      providerId: "grok-google",
      callbackURL: "/admin",
      errorCallbackURL: "/login?redirect=%2Fadmin",
      disableRedirect: true,
    });
    assert.equal(configuredOAuth.status, 200);
    assert.equal(configuredOAuth.response.redirect, false);
    const configuredOAuthUrl = new URL(configuredOAuth.response.url);
    assert.equal(
      configuredOAuthUrl.searchParams.get("client_id"),
      "account-browser-oauth-client",
    );
    assert.equal(configuredOAuthUrl.searchParams.get("idp"), "google");
    await page.unroute("**/api/auth/sign-in/oauth2");

    await page.goto(`${baseUrl}/registreren`, { waitUntil: "networkidle" });
    await page.getByLabel("Naam").fill("Mobiele Accountklant");
    await page.getByLabel("E-mailadres").fill(email);
    await page.getByLabel(/^Wachtwoord/).fill(firstPassword);
    await page.getByLabel("Herhaal wachtwoord").fill(firstPassword);
    await page.getByRole("button", { name: "Account aanmaken" }).click();
    const registrationCopy = page.getByText(
      /Als dit e-mailadres nog niet bij ons bekend is/i,
    );
    await registrationCopy.waitFor();
    const newAccountRegistrationCopy = await registrationCopy.innerText();

    await page.goto(`${baseUrl}/registreren`, { waitUntil: "networkidle" });
    await page.getByLabel("Naam").fill("Mobiele Accountklant");
    await page.getByLabel("E-mailadres").fill(email);
    await page.getByLabel(/^Wachtwoord/).fill(firstPassword);
    await page.getByLabel("Herhaal wachtwoord").fill(firstPassword);
    await page.getByRole("button", { name: "Account aanmaken" }).click();
    await registrationCopy.waitFor();
    assert.equal(
      await registrationCopy.innerText(),
      newAccountRegistrationCopy,
    );

    await page.goto(`${baseUrl}/registreren`, { waitUntil: "networkidle" });
    await page.route("**/api/auth/sign-up/email", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "Testfout" }),
      });
    });
    await page.getByLabel("Naam").fill("Tijdelijke Testfout");
    await page
      .getByLabel("E-mailadres")
      .fill(`registratiefout-${randomUUID()}@example.test`);
    await page.getByLabel(/^Wachtwoord/).fill(firstPassword);
    await page.getByLabel("Herhaal wachtwoord").fill(firstPassword);
    await page.getByRole("button", { name: "Account aanmaken" }).click();
    await page
      .getByText("Account aanmaken lukt nu niet. Probeer het later opnieuw.")
      .waitFor();
    assert.equal(await registrationCopy.count(), 0);
    await page.unroute("**/api/auth/sign-up/email");

    const initialVerificationUrl = await waitForMailUrl(
      email,
      "/api/auth/verify-email?token=",
    );
    await page.waitForTimeout(1_100);

    await page.goto(`${baseUrl}/bevestigingsmail-opnieuw`, {
      waitUntil: "networkidle",
    });
    await page.getByLabel("E-mailadres").fill(email);
    await page
      .getByRole("button", { name: "Nieuwe bevestigingsmail aanvragen" })
      .click();
    const genericCopy = page.getByText(
      /Als dit e-mailadres bij een onbevestigd account hoort/i,
    );
    await genericCopy.waitFor();
    const existingAccountCopy = await genericCopy.innerText();
    const verificationUrl = await waitForMailUrl(
      email,
      "/api/auth/verify-email?token=",
      2,
    );
    assert.notEqual(verificationUrl, initialVerificationUrl);

    await page.goto(`${baseUrl}/bevestigingsmail-opnieuw`, {
      waitUntil: "networkidle",
    });
    await page.getByLabel("E-mailadres").fill(unknownEmail);
    await page
      .getByRole("button", { name: "Nieuwe bevestigingsmail aanvragen" })
      .click();
    await genericCopy.waitFor();
    assert.equal(await genericCopy.innerText(), existingAccountCopy);

    await page.goto(`${baseUrl}/bevestigingsmail-opnieuw`, {
      waitUntil: "networkidle",
    });
    await page.route("**/api/auth/send-verification-email", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "Testfout" }),
      });
    });
    await page.getByLabel("E-mailadres").fill(email);
    await page
      .getByRole("button", { name: "Nieuwe bevestigingsmail aanvragen" })
      .click();
    await page
      .getByText(/De bevestigingsmail kon niet worden aangevraagd/i)
      .waitFor();
    assert.equal(await genericCopy.count(), 0);
    await page.unroute("**/api/auth/send-verification-email");

    await page.goto(`${baseUrl}/wachtwoord-vergeten`, {
      waitUntil: "networkidle",
    });
    await page.getByLabel("E-mailadres").fill(email);
    await page.getByRole("button", { name: "Herstellink aanvragen" }).click();
    const forgotPasswordCopy = page.getByText(
      /Als dit e-mailadres bij ons bekend is/i,
    );
    await forgotPasswordCopy.waitFor();
    const existingForgotPasswordCopy = await forgotPasswordCopy.innerText();

    await page.goto(`${baseUrl}/wachtwoord-vergeten`, {
      waitUntil: "networkidle",
    });
    await page.getByLabel("E-mailadres").fill(unknownEmail);
    await page.getByRole("button", { name: "Herstellink aanvragen" }).click();
    await forgotPasswordCopy.waitFor();
    assert.equal(
      await forgotPasswordCopy.innerText(),
      existingForgotPasswordCopy,
    );

    await page.goto(`${baseUrl}/wachtwoord-vergeten`, {
      waitUntil: "networkidle",
    });
    await page.route("**/api/auth/request-password-reset", async (route) => {
      await route.abort("connectionfailed");
    });
    await page.getByLabel("E-mailadres").fill(email);
    await page.getByRole("button", { name: "Herstellink aanvragen" }).click();
    await page
      .getByText(/De herstellink kon niet worden aangevraagd/i)
      .waitFor();
    assert.equal(await forgotPasswordCopy.count(), 0);
    await page.unroute("**/api/auth/request-password-reset");

    await page.goto(`${baseUrl}/login?verified=1&error=token_expired`, {
      waitUntil: "networkidle",
    });
    await page.getByText(/bevestigingslink is ongeldig of verlopen/i).waitFor();
    assert.equal(
      await page
        .getByText("Je e-mailadres is bevestigd. Je kunt nu inloggen.")
        .count(),
      0,
    );

    const resetUrl = await waitForMailUrl(email, "/api/auth/reset-password/");
    assert.ok(verificationUrl);
    assert.ok(resetUrl);

    await page.goto(onTestOrigin(verificationUrl), {
      waitUntil: "networkidle",
    });
    await page.waitForURL(/\/login/, { timeout: 5_000 });
    assert.equal(new URL(page.url()).searchParams.get("error"), null);
    await page
      .getByText("Je e-mailadres is bevestigd. Je kunt nu inloggen.")
      .waitFor();

    const resetToken = new URL(resetUrl).pathname.split("/").at(-1);
    assert.ok(resetToken);
    await page.goto(
      `${baseUrl}/wachtwoord-herstellen?token=${encodeURIComponent(resetToken)}`,
      { waitUntil: "networkidle" },
    );
    await page.waitForURL(/\/wachtwoord-herstellen\?token=/);
    await page.getByLabel(/^Nieuw wachtwoord/).fill(resetPassword);
    await page.getByLabel("Herhaal wachtwoord").fill(resetPassword);
    await page.getByRole("button", { name: "Wachtwoord opslaan" }).click();
    await page.getByText("Je wachtwoord is bijgewerkt.").waitFor();
    await page.getByRole("link", { name: "Naar inloggen" }).click();
    await page.getByLabel("E-mailadres").fill(email);
    await page.getByLabel("Wachtwoord").fill(resetPassword);
    await page.getByRole("button", { name: "Inloggen" }).click();
    await page.waitForURL(`${baseUrl}/account`);
    await page.getByRole("heading", { name: "Bestelgeschiedenis" }).waitFor();

    await page.getByRole("button", { name: "Bevestigingslink sturen" }).click();
    await page.getByText(/Controleer je e-mail om eerdere/i).waitFor();
    const claimUrl = await waitForMailUrl(email, "/account#claim=");
    assert.ok(claimUrl);
    await page.evaluate((url) => {
      window.location.hash = new URL(url).hash;
    }, claimUrl);
    await page
      .getByText("Eén eerdere gastbestelling is veilig gekoppeld.")
      .waitFor({ timeout: 15_000 });

    const orderCard = page
      .locator("details")
      .filter({ hasText: guestOrder.order.orderNumber });
    await orderCard.waitFor();
    await orderCard.getByText("Details", { exact: true }).waitFor();
    assert.equal(await orderCard.locator("summary").isVisible(), true);
    assert.equal(await orderCard.locator("address").isVisible(), false);
    await orderCard.locator("summary").click();
    await orderCard.locator("address").waitFor();
    assert.match(
      await orderCard.locator("address").innerText(),
      /Teststraat 12 A/,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );

    const passwordPanel = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Wachtwoord wijzigen" }),
    });
    await passwordPanel.getByLabel("Huidig wachtwoord").fill(resetPassword);
    await passwordPanel
      .getByLabel("Nieuw wachtwoord", { exact: true })
      .fill(finalPassword);
    await passwordPanel
      .getByLabel("Herhaal nieuw wachtwoord")
      .fill(finalPassword);
    await passwordPanel
      .getByRole("button", { name: "Wachtwoord wijzigen" })
      .click();
    await passwordPanel.getByText(/Je wachtwoord is gewijzigd/i).waitFor();

    await passwordPanel.getByLabel("Huidig wachtwoord").fill(finalPassword);
    await passwordPanel
      .getByLabel("Nieuw wachtwoord", { exact: true })
      .fill("Vierde-sterke-code-2026");
    await passwordPanel
      .getByLabel("Herhaal nieuw wachtwoord")
      .fill("Andere-sterke-code-2026");
    await passwordPanel
      .getByRole("button", { name: "Wachtwoord wijzigen" })
      .click();
    await passwordPanel
      .getByText("De nieuwe wachtwoorden zijn niet gelijk.")
      .waitFor();
    assert.equal(
      await passwordPanel.getByText(/Je wachtwoord is gewijzigd/i).count(),
      0,
    );
  } finally {
    await page.waitForTimeout(500).catch(() => {});
    await context.close();
  }
});
