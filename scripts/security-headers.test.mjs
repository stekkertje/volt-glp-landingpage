import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let vite;
let securityHeadersForPath;

before(async () => {
  vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ securityHeadersForPath } = await vite.ssrLoadModule(
    "/src/lib/security-headers.ts",
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
