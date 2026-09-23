import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let vite;
let resolveAdminConfiguration;
let resolveAdminAuthorizationConfiguration;
let hasConfiguredAdminAccess;
let signAdminSession;

before(async () => {
  vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({
    resolveAdminConfiguration,
    resolveAdminAuthorizationConfiguration,
    hasConfiguredAdminAccess,
  } = await vite.ssrLoadModule("/src/lib/server/admin-policy.server.ts"));
  ({ signAdminSession } = await vite.ssrLoadModule(
    "/src/lib/server/admin-session.server.ts",
  ));
});

after(async () => {
  await vite?.close();
});

test("ADMIN_EMAILS authorizes an allowlisted Better Auth identity by itself", () => {
  const config = resolveAdminConfiguration({
    NODE_ENV: "production",
    ADMIN_EMAILS: " beheer@example.nl,ANDER@example.nl ",
  });
  assert.equal(config.passwordLogin, null);
  assert.equal(
    hasConfiguredAdminAccess(
      { sessionCookie: null, userEmail: "beheer@example.nl" },
      config,
    ),
    true,
  );
  assert.equal(
    hasConfiguredAdminAccess(
      { sessionCookie: null, userEmail: "niet@example.nl" },
      config,
    ),
    false,
  );
});

test("a strong password-only configuration accepts its signed session", () => {
  const config = resolveAdminConfiguration({
    NODE_ENV: "production",
    ADMIN_PASSWORD: "sterk-beheer-wachtwoord-2026",
    ADMIN_SESSION_SECRET: "s".repeat(48),
  });
  assert.ok(config.passwordLogin);
  const cookie = signAdminSession(
    config.passwordLogin.sessionSecret,
    Date.now() + 60_000,
  );
  assert.equal(
    hasConfiguredAdminAccess(
      { sessionCookie: cookie, userEmail: null },
      config,
    ),
    true,
  );
});

test("strict base64 and base64url preserve the exact Hostinger login value", () => {
  const password = "bestaand%beheer-wachtwoord-2026🔐";
  for (const encoding of ["base64", "base64url"]) {
    const config = resolveAdminConfiguration({
      NODE_ENV: "production",
      ADMIN_PASSWORD_BASE64: Buffer.from(password, "utf8").toString(encoding),
      ADMIN_SESSION_SECRET: "s".repeat(48),
    });
    assert.equal(config.passwordLogin?.password, password, encoding);
  }
});

test("password sources and encoded bytes fail closed when ambiguous or invalid", () => {
  const common = {
    NODE_ENV: "production",
    ADMIN_SESSION_SECRET: "s".repeat(48),
  };
  assert.throws(
    () =>
      resolveAdminConfiguration({
        ...common,
        ADMIN_PASSWORD: "sterk-beheer-wachtwoord-2026",
        ADMIN_PASSWORD_BASE64: Buffer.from(
          "sterk-beheer-wachtwoord-2026",
        ).toString("base64"),
      }),
    /nooit beide/i,
  );
  for (const encoded of [
    "geen%base64",
    "YQ=",
    "_w",
    "AA==",
    Buffer.from(`sterk-beheer-${"x".repeat(16)}\u0085`, "utf8").toString(
      "base64",
    ),
  ]) {
    assert.throws(
      () =>
        resolveAdminConfiguration({
          ...common,
          ADMIN_PASSWORD_BASE64: encoded,
        }),
      /ADMIN_PASSWORD_BASE64/,
      encoded,
    );
  }
});

test("partial or weak production password configuration fails closed", () => {
  assert.throws(
    () =>
      resolveAdminConfiguration({
        NODE_ENV: "production",
        ADMIN_PASSWORD: "sterk-beheer-wachtwoord-2026",
      }),
    /ADMIN_SESSION_SECRET/,
  );
  assert.throws(
    () =>
      resolveAdminConfiguration({
        NODE_ENV: "production",
        ADMIN_SESSION_SECRET: "s".repeat(48),
      }),
    /ADMIN_PASSWORD/,
  );
  assert.throws(
    () =>
      resolveAdminConfiguration({
        NODE_ENV: "production",
        ADMIN_PASSWORD: "te-kort",
        ADMIN_SESSION_SECRET: "kort",
      }),
    /sterk|tekens|ADMIN_/i,
  );
});

test("broken admin fallback configuration cannot break public authorization probes", () => {
  assert.equal(
    resolveAdminAuthorizationConfiguration({
      NODE_ENV: "production",
      ADMIN_PASSWORD: "sterk-beheer-wachtwoord-2026",
    }),
    null,
  );
});

test("expired password sessions are rejected", () => {
  const config = resolveAdminConfiguration({
    NODE_ENV: "production",
    ADMIN_PASSWORD: "sterk-beheer-wachtwoord-2026",
    ADMIN_SESSION_SECRET: "s".repeat(48),
  });
  const now = Date.now();
  const expired = signAdminSession(config.passwordLogin.sessionSecret, now - 1);
  assert.equal(
    hasConfiguredAdminAccess(
      { sessionCookie: expired, userEmail: null, now },
      config,
    ),
    false,
  );
});

test("the environment template documents every admin mode", async () => {
  const template = await readFile(".env.example", "utf8");
  assert.match(template, /^ADMIN_EMAILS=$/m);
  assert.match(template, /^ADMIN_PASSWORD=$/m);
  assert.match(template, /^ADMIN_PASSWORD_BASE64=$/m);
  assert.match(template, /^ADMIN_SESSION_SECRET=$/m);
});
