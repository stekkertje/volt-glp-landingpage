import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let vite;
let securityHeadersForPath;
let shouldSendHsts;

before(async () => {
  vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ securityHeadersForPath } = await vite.ssrLoadModule(
    "/src/lib/security-headers.ts",
  ));
  ({ shouldSendHsts } = await vite.ssrLoadModule(
    "/server/middleware/00-security-headers.ts",
  ));
});

after(async () => {
  await vite?.close();
});

test("production security policy avoids dev-only eval and permits trusted preview framing", () => {
  const headers = securityHeadersForPath("/");
  assert.match(headers["content-security-policy"], /default-src 'self'/);
  assert.doesNotMatch(headers["content-security-policy"], /unsafe-eval/);
  assert.match(
    headers["content-security-policy"],
    /frame-ancestors 'self' https:\/\/grok\.com/,
  );
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.equal(headers["referrer-policy"], "strict-origin-when-cross-origin");
});

test("admin and order documents are never cacheable", () => {
  for (const path of [
    "/admin",
    "/account",
    "/checkout",
    "/bestelling/order-id",
  ]) {
    const headers = securityHeadersForPath(path);
    assert.equal(headers["cache-control"], "no-store", path);
    assert.equal(headers.pragma, "no-cache", path);
  }
});

test("sensitive documents reject untrusted deployed sibling frames", () => {
  assert.match(
    securityHeadersForPath("/")["content-security-policy"],
    /frame-ancestors[^;]*https:\/\/\*\.grok\.me/,
  );
  for (const path of [
    "/admin",
    "/account",
    "/checkout",
    "/bestelling/order-id",
  ]) {
    const policy = securityHeadersForPath(path)["content-security-policy"];
    assert.match(policy, /frame-ancestors 'self' https:\/\/grok\.com/, path);
    assert.doesNotMatch(policy, /https:\/\/\*\.grok\.me/, path);
  }
});

test("development policy allows Vite evaluation without weakening production", () => {
  const headers = securityHeadersForPath("/", { development: true });
  assert.match(headers["content-security-policy"], /unsafe-eval/);
  assert.equal(headers["strict-transport-security"], undefined);
});

test("HSTS is opt-in for a production HTTPS response only", () => {
  const headers = securityHeadersForPath("/", { hsts: true });
  assert.equal(headers["strict-transport-security"], "max-age=31536000");
  assert.doesNotMatch(
    headers["strict-transport-security"],
    /includeSubDomains/i,
  );
});

test("HSTS recognizes only the configured Hostinger HTTPS proxy", () => {
  const event = (headers = {}) => ({
    url: new URL("http://127.0.0.1:3000/checkout"),
    req: { headers: new Headers(headers) },
  });
  const environment = {
    NODE_ENV: "production",
    TRUST_HOSTINGER_PROXY: "1",
    VITE_PUBLIC_HOSTNAME: "afslank-injecties.nl",
  };

  assert.equal(shouldSendHsts(event(), environment), true);
  assert.equal(
    shouldSendHsts(event(), {
      ...environment,
      VITE_PUBLIC_HOSTNAME: "evil.example.test/path",
    }),
    false,
  );
  assert.equal(
    shouldSendHsts(event(), { ...environment, TRUST_HOSTINGER_PROXY: "0" }),
    false,
  );
});

test("deployment-wide noindex is opt-in and covers every path", () => {
  assert.equal(securityHeadersForPath("/")["x-robots-tag"], undefined);
  for (const path of ["/", "/product/semaglutide-2mg", "/admin"]) {
    assert.equal(
      securityHeadersForPath(path, { noIndex: true })["x-robots-tag"],
      "noindex, nofollow, noarchive",
      path,
    );
  }
});
