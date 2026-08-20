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
    "BETTER_AUTH_URL",
    "ADDRESS_VALIDATION_TOKEN_SECRET",
    "ORDER_ACCESS_TOKEN_SECRET",
    "ORDER_ACCESS_TOKEN_PREVIOUS_SECRETS",
    "ADMIN_EMAILS",
    "ADMIN_PASSWORD",
    "ADMIN_PASSWORD_BASE64",
    "ADMIN_SESSION_SECRET",
    "MAILBOX_ADDRESS",
    "MAILBOX_PASSWORD",
    "MAIL_TEST_RECIPIENT",
    "REQUIRE_MAIL",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_SECURE",
    "SMTP_USER",
    "SMTP_USERNAME",
    "SMTP_PASSWORD",
    "MAIL_FROM_ADDRESS",
    "MAIL_FROM_NAME",
    "MAIL_OWNER_ADDRESS",
    "APICHECK_API_KEY",
    "APICHECK_BASE_URL",
    "GOOGLE_ADDRESS_VALIDATION_API_KEY",
    "GOOGLE_ADDRESS_VALIDATION_BASE_URL",
    "MYPARCEL_API_KEY",
    "MYPARCEL_API_BASE_URL",
    "MYPARCEL_WEBHOOK_SECRET",
    "HOSTINGER_API_TOKEN",
    "CLOUDFLARE_API_TOKEN",
    "NITRO_PRESET",
    "NO_INDEX",
    "VITE_NO_INDEX",
    "VITE_PUBLIC_HOSTNAME",
    "VITE_AUTH_ENABLED",
    "VITE_EMAIL_PASSWORD_AUTH_ENABLED",
    "TRUST_HOSTINGER_PROXY",
  ]) {
    assert.equal(process.env[name], undefined, `${name} moet afgeschermd zijn`);
  }
});
