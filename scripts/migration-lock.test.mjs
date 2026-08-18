import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MIGRATION_LOCK_KEY,
  withMigrationLock,
} from "./migration-lock.mjs";

test("migration lock surrounds the complete scan and apply callback", async () => {
  const events = [];
  const client = {
    async query(text, params) {
      events.push({ text, params });
      return { rows: [] };
    },
  };

  const result = await withMigrationLock(client, async () => {
    events.push({ text: "scan-and-apply" });
    return "klaar";
  });

  assert.equal(result, "klaar");
  assert.deepEqual(
    events.map((event) => event.text),
    [
      "select pg_advisory_lock($1::bigint)",
      "scan-and-apply",
      "select pg_advisory_unlock($1::bigint)",
    ],
  );
  assert.deepEqual(events[0].params, [MIGRATION_LOCK_KEY]);
  assert.deepEqual(events[2].params, [MIGRATION_LOCK_KEY]);
});

test("migration lock releases in finally and preserves migration errors", async () => {
  const events = [];
  const expected = new Error("migratie mislukt");
  const client = {
    async query(text) {
      events.push(text);
      return { rows: [] };
    },
  };

  await assert.rejects(
    withMigrationLock(client, async () => {
      events.push("apply");
      throw expected;
    }),
    (error) => error === expected,
  );
  assert.deepEqual(events, [
    "select pg_advisory_lock($1::bigint)",
    "apply",
    "select pg_advisory_unlock($1::bigint)",
  ]);
});
