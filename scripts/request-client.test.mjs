import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let vite;
let resolveClientIdentifier;

before(async () => {
  vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ resolveClientIdentifier } = await vite.ssrLoadModule(
    "/src/lib/server/request-client.server.ts",
  ));
});

after(async () => {
  await vite?.close();
});

test("local and unknown hosts ignore spoofable forwarded IP headers", () => {
  const headers = new Headers({
    "x-forwarded-for": "198.51.100.99",
    "x-real-ip": "198.51.100.98",
  });
  assert.equal(
    resolveClientIdentifier({
      headers,
      directIp: "127.0.0.1",
      environment: { NODE_ENV: "development" },
    }),
    "127.0.0.1",
  );
});

test("Hostinger trusts only its overwritten single-value client-IP header", () => {
  const headers = new Headers({
    "x-forwarded-for": "198.51.100.99, 198.51.100.100",
    "x-real-ip": "203.0.113.42",
  });
  assert.equal(
    resolveClientIdentifier({
      headers,
      directIp: "127.0.0.1",
      environment: {
        NODE_ENV: "production",
        TRUST_HOSTINGER_PROXY: "1",
      },
    }),
    "203.0.113.42",
  );
});

test("Hostinger rejects malformed client-IP headers instead of trusting a chain", () => {
  const headers = new Headers({
    "x-forwarded-for": "203.0.113.42",
    "x-real-ip": "203.0.113.42, 198.51.100.99",
  });
  assert.equal(
    resolveClientIdentifier({
      headers,
      directIp: "127.0.0.1",
      environment: {
        NODE_ENV: "production",
        TRUST_HOSTINGER_PROXY: "1",
      },
    }),
    "127.0.0.1",
  );
});

test("Vercel deployments trust only the platform client-IP header", () => {
  const headers = new Headers({
    "x-forwarded-for": "198.51.100.99",
    "x-real-ip": "203.0.113.42",
  });
  assert.equal(
    resolveClientIdentifier({
      headers,
      directIp: "10.0.0.2",
      environment: { NODE_ENV: "production", VERCEL: "1" },
    }),
    "203.0.113.42",
  );
});

test("missing trusted IP data falls back to a stable anonymous bucket", () => {
  assert.equal(
    resolveClientIdentifier({
      headers: new Headers({ "x-forwarded-for": "198.51.100.99" }),
      directIp: null,
      environment: { NODE_ENV: "production", VERCEL: "1" },
    }),
    "anonymous",
  );
});
