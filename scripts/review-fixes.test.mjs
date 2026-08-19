import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let vite;
let ADMIN_COOKIE_NAME;
let GUEST_ORDER_COOKIE;
let SITE;
let canonicalCheckoutPayload;
let checkoutIdempotencyKeyFromSeed;
let consumeOrderRecoveryCode;
let getAdminCapabilities;
let isConflictServerError;
let isSameOriginMutationRequest;
let stageOrderRecoveryCode;

const checkoutPayload = (overrides = {}) => ({
  name: "Noor de Vries",
  email: "noor@example.test",
  phone: "0612345678",
  street: "Teststraat",
  houseNumber: "12 A",
  postcode: "1234 AB",
  city: "Utrecht",
  country: "NL",
  note: "Bel aan.",
  discountCode: "volt10",
  lines: [
    { slug: "semaglutide-2mg", optionId: "none", qty: 1 },
    { slug: "semaglutide-2mg", optionId: "none", qty: 1 },
  ],
  ...overrides,
});

before(async () => {
  vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ ADMIN_COOKIE_NAME, getAdminCapabilities, isSameOriginMutationRequest } =
    await vite.ssrLoadModule("/src/lib/server/admin-auth.server.ts"));
  ({ GUEST_ORDER_COOKIE } = await vite.ssrLoadModule(
    "/src/lib/server/orders.ts",
  ));
  ({ SITE } = await vite.ssrLoadModule("/src/lib/product.ts"));
  ({ canonicalCheckoutPayload, checkoutIdempotencyKeyFromSeed } =
    await vite.ssrLoadModule("/src/lib/checkout-idempotency.ts"));
  ({ stageOrderRecoveryCode, consumeOrderRecoveryCode } =
    await vite.ssrLoadModule("/src/lib/order-recovery-memory.ts"));
  ({ isConflictServerError } = await vite.ssrLoadModule(
    "/src/lib/server-error.ts",
  ));
});

after(async () => {
  await vite?.close();
});

test("shop cookies use the host-only prefix", () => {
  assert.equal(ADMIN_COOKIE_NAME, "__Host-volt-admin-session");
  assert.equal(GUEST_ORDER_COOKIE, "__Host-volt-order-access");
});

test("checkout payload serialization is canonical and changes with order data", () => {
  const split = checkoutPayload();
  const combined = checkoutPayload({
    discountCode: "VOLT10",
    lines: [{ slug: "semaglutide-2mg", optionId: "none", qty: 2 }],
  });
  assert.equal(
    canonicalCheckoutPayload(split),
    canonicalCheckoutPayload(combined),
  );
  assert.notEqual(
    canonicalCheckoutPayload(combined),
    canonicalCheckoutPayload(
      checkoutPayload({
        street: "Andere straat",
        lines: [{ slug: "semaglutide-2mg", optionId: "none", qty: 2 }],
      }),
    ),
  );
});

test("checkout keeps one seed-derived key until an attempt is resolved", async () => {
  const seed = "b".repeat(64);
  const first = await checkoutIdempotencyKeyFromSeed(seed);
  const retry = await checkoutIdempotencyKeyFromSeed(seed);
  const nextAttempt = await checkoutIdempotencyKeyFromSeed("c".repeat(64));

  assert.equal(retry, first);
  assert.notEqual(nextAttempt, first);
});

test("a staged recovery code is memory-only and consumed once", () => {
  stageOrderRecoveryCode("order-review-test", "ABCD-EFGH");
  assert.equal(consumeOrderRecoveryCode("order-review-test"), "ABCD-EFGH");
  assert.equal(consumeOrderRecoveryCode("order-review-test"), null);
});

test("same-origin mutation checks ignore spoofable forwarded hosts", () => {
  const sameOriginUrl = "https://shop.example.test/_server";
  assert.equal(
    isSameOriginMutationRequest(
      new Request(sameOriginUrl, {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin" },
      }),
    ),
    true,
  );
  assert.equal(
    isSameOriginMutationRequest(
      new Request(sameOriginUrl, {
        method: "POST",
        headers: { origin: "https://shop.example.test" },
      }),
    ),
    true,
  );
  assert.equal(
    isSameOriginMutationRequest(
      new Request(sameOriginUrl, {
        method: "POST",
        headers: { referer: "https://shop.example.test/checkout" },
      }),
    ),
    true,
  );
  assert.equal(
    isSameOriginMutationRequest(
      new Request(sameOriginUrl, {
        method: "POST",
        headers: {
          origin: "https://evil.example.test",
          "x-forwarded-host": "evil.example.test",
          "x-forwarded-proto": "https",
        },
      }),
    ),
    false,
  );
  assert.equal(
    isSameOriginMutationRequest(
      new Request(sameOriginUrl, {
        method: "POST",
        headers: { "sec-fetch-site": "same-site" },
      }),
    ),
    false,
  );
  assert.equal(
    isSameOriginMutationRequest(new Request(sameOriginUrl, { method: "POST" })),
    false,
  );

  const hostingerProxyRequest = new Request("http://127.0.0.1:3000/_server", {
    method: "POST",
    headers: {
      origin: "https://afslank-injecties.nl",
      referer: "https://afslank-injecties.nl/checkout",
      "sec-fetch-site": "same-origin",
    },
  });
  assert.equal(
    isSameOriginMutationRequest(hostingerProxyRequest, {}),
    false,
    "forwarded headers blijven zonder expliciete Hostinger-trust buiten gebruik",
  );
  assert.equal(
    isSameOriginMutationRequest(hostingerProxyRequest, {
      NODE_ENV: "production",
      TRUST_HOSTINGER_PROXY: "1",
      VITE_PUBLIC_HOSTNAME: "afslank-injecties.nl",
    }),
    true,
  );
  for (const headers of [
    {
      origin: "https://evil.example.test",
      referer: "https://afslank-injecties.nl/checkout",
    },
    {
      origin: "https://afslank-injecties.nl",
      referer: "https://evil.example.test/checkout",
    },
    {
      origin: "https://afslank-injecties.nl",
      referer: "https://afslank-injecties.nl/checkout",
      "sec-fetch-site": "cross-site",
    },
  ]) {
    assert.equal(
      isSameOriginMutationRequest(
        new Request("http://127.0.0.1:3000/_server", {
          method: "POST",
          headers: { "sec-fetch-site": "same-origin", ...headers },
        }),
        {
          NODE_ENV: "production",
          TRUST_HOSTINGER_PROXY: "1",
          VITE_PUBLIC_HOSTNAME: "afslank-injecties.nl",
        },
      ),
      false,
    );
  }
});

test("broken admin configuration becomes a not-configured capability state", () => {
  assert.deepEqual(
    getAdminCapabilities({
      NODE_ENV: "production",
      ADMIN_PASSWORD: "sterk-beheer-wachtwoord-2026",
    }),
    {
      passwordLoginAvailable: false,
      allowlistConfigured: false,
    },
  );
});

test("review configuration keeps the explicit order ceilings", () => {
  assert.equal(SITE.shippingCents, 495);
  assert.equal(SITE.maxLineQuantity, 10);
  assert.equal(SITE.maxOrderQuantity, 90);
});

test("checkout conflicts are recognized separately from generic errors", () => {
  assert.equal(isConflictServerError({ status: 409 }), true);
  assert.equal(
    isConflictServerError({ name: "IdempotencyConflictError" }),
    true,
  );
  assert.equal(isConflictServerError({ status: 500 }), false);
});

test("review documentation and recovery flow contain no stale demo or recovery storage path", async () => {
  const [briefing, account, checkout, confirmation, orderFunctions, adminAuth] =
    await Promise.all([
      readFile("GROK.md", "utf8"),
      readFile("src/routes/account.tsx", "utf8"),
      readFile("src/routes/checkout.tsx", "utf8"),
      readFile("src/routes/bestelling.$id.tsx", "utf8"),
      readFile("src/lib/server/orders.ts", "utf8"),
      readFile("src/lib/server/admin-auth.server.ts", "utf8"),
    ]);
  assert.doesNotMatch(briefing, /checkout zijn DEMO|demo-submit|nep-success/i);
  assert.match(
    account,
    /<GuestOrderAccess showLogin=\{authEnabled && !user\} \/>/,
  );
  assert.match(account, /user && !user\.isDevFallback && <SignedInOrders \/>/);
  assert.doesNotMatch(confirmation, /sessionStorage/);
  assert.match(checkout, /Deze bestelling is al geplaatst/);
  assert.match(
    checkout,
    /name: "robots", content: "noindex, nofollow, noarchive"/,
  );
  assert.doesNotMatch(orderFunctions, /secure:\s*process\.env\.NODE_ENV/);
  assert.doesNotMatch(adminAuth, /secure:\s*productionCookie/);
  assert.equal((orderFunctions.match(/secure:\s*true/g) ?? []).length, 2);
  assert.equal((adminAuth.match(/secure:\s*true/g) ?? []).length, 2);
});
