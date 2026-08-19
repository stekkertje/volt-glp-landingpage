import assert from "node:assert/strict";
import { test } from "node:test";

test("npm test cannot inherit production databases or deployment secrets", () => {
  assert.equal(process.env.NODE_ENV, "test");
  for (const name of [
    "DATABASE_URL",
    "DATABASE_URL_UNPOOLED",
    "MIGRATION_DATABASE_URL",
    "TEST_MIGRATION_DATABASE_URL",
    "NEON_API_KEY",
    "BETTER_AUTH_SECRET",
    "ORDER_ACCESS_TOKEN_SECRET",
    "ORDER_ACCESS_TOKEN_PREVIOUS_SECRETS",
    "ADMIN_EMAILS",
    "ADMIN_PASSWORD",
    "ADMIN_SESSION_SECRET",
    "MAILBOX_ADDRESS",
    "MAILBOX_PASSWORD",
    "MAIL_TEST_RECIPIENT",
    "HOSTINGER_API_TOKEN",
    "CLOUDFLARE_API_TOKEN",
    "NITRO_PRESET",
    "NO_INDEX",
    "VITE_NO_INDEX",
    "VITE_PUBLIC_HOSTNAME",
    "VITE_AUTH_ENABLED",
  ]) {
    assert.equal(process.env[name], undefined, `${name} moet afgeschermd zijn`);
  }
});
