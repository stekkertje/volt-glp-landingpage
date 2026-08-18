import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { createServer } from "vite";

let vite;
let getSql;
let consumeRateLimit;

before(async () => {
  vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ consumeRateLimit } = await vite.ssrLoadModule(
    "/src/lib/server/rate-limit.server.ts",
  ));
});

after(async () => {
  await vite?.close();
});

test("rate limiting is atomically persisted without storing the raw identifier", async () => {
  const identifier = `203.0.113.${Math.floor(Math.random() * 200) + 1}-${randomUUID()}`;
  const scope = `test-${randomUUID()}`;
  const now = new Date("2026-08-18T00:00:00.000Z");
  const options = {
    scope,
    identifier,
    limit: 2,
    windowMs: 60_000,
    now,
  };

  const first = await consumeRateLimit(options);
  const second = await consumeRateLimit(options);
  assert.equal(first.count, 1);
  assert.equal(second.count, 2);
  await assert.rejects(
    consumeRateLimit(options),
    (error) =>
      error?.name === "RateLimitError" &&
      error?.status === 429 &&
      error?.retryAfterMs > 0,
  );

  const sql = await getSql();
  const rows = await sql.query(
    `select key_hash, request_count
     from rate_limit_buckets
     where scope = $1`,
    [scope],
  );
  assert.equal(rows.length, 1);
  assert.match(rows[0].key_hash, /^[a-f0-9]{64}$/);
  assert.notEqual(rows[0].key_hash, identifier);
  assert.equal(rows[0].request_count, 3);
});

test("a new fixed window starts with a fresh allowance", async () => {
  const identifier = randomUUID();
  const scope = `window-${randomUUID()}`;
  const firstWindow = {
    scope,
    identifier,
    limit: 1,
    windowMs: 60_000,
    now: new Date("2026-08-18T00:00:00.000Z"),
  };
  await consumeRateLimit(firstWindow);
  await assert.rejects(consumeRateLimit(firstWindow), /te veel|opnieuw/i);

  const next = await consumeRateLimit({
    ...firstWindow,
    now: new Date("2026-08-18T00:01:00.000Z"),
  });
  assert.equal(next.count, 1);
});
