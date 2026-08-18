import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MIGRATION_LOCK_KEY,
  MIGRATION_LOCK_TIMEOUT_MS,
  MIGRATION_UNLOCK_TIMEOUT_MS,
  withMigrationLock,
} from "./migration-lock.mjs";
import {
  resolveMigrationDatabaseUrl,
  withDedicatedMigrationClient,
} from "./migration-database.mjs";

function queryText(query) {
  return typeof query === "string" ? query : query.text;
}

function queryValues(query, values) {
  return typeof query === "string" ? values : query.values;
}

test("migration lock surrounds the complete scan and apply callback", async () => {
  const events = [];
  const client = {
    async query(query, values) {
      const text = queryText(query);
      events.push({
        text,
        params: queryValues(query, values),
        queryTimeout:
          typeof query === "string" ? undefined : query.query_timeout,
      });
      return {
        rows: text.includes("pg_try_advisory_lock")
          ? [{ locked: true }]
          : text.includes("pg_advisory_unlock")
            ? [{ unlocked: true }]
            : [],
      };
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
      "select pg_try_advisory_lock($1::bigint) as locked",
      "scan-and-apply",
      "select pg_advisory_unlock($1::bigint) as unlocked",
    ],
  );
  assert.deepEqual(events[0].params, [MIGRATION_LOCK_KEY]);
  assert.deepEqual(events[2].params, [MIGRATION_LOCK_KEY]);
  assert.ok(events[0].queryTimeout <= MIGRATION_LOCK_TIMEOUT_MS);
  assert.equal(events[2].queryTimeout, MIGRATION_UNLOCK_TIMEOUT_MS);
});

test("migration lock releases in finally and preserves migration errors", async () => {
  const events = [];
  const expected = new Error("migratie mislukt");
  const client = {
    async query(query) {
      const text = queryText(query);
      events.push(text);
      return {
        rows: text.includes("pg_try_advisory_lock")
          ? [{ locked: true }]
          : text.includes("pg_advisory_unlock")
            ? [{ unlocked: true }]
            : [],
      };
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
    "select pg_try_advisory_lock($1::bigint) as locked",
    "apply",
    "select pg_advisory_unlock($1::bigint) as unlocked",
  ]);
});

test("migration lock fails closed when the session did not own the lock", async () => {
  const client = {
    async query(query) {
      const text = queryText(query);
      return {
        rows: text.includes("pg_try_advisory_lock")
          ? [{ locked: true }]
          : text.includes("pg_advisory_unlock")
            ? [{ unlocked: false }]
            : [],
      };
    },
  };
  await assert.rejects(
    withMigrationLock(client, async () => undefined),
    /lock.*niet.*databaseverbinding|pooled/i,
  );
});

test("migration lock acquisition fails within a bounded deadline", async () => {
  let currentTime = 1_000;
  let attempts = 0;
  let applied = false;
  const client = {
    async query(query) {
      const text = queryText(query);
      assert.match(text, /pg_try_advisory_lock/);
      attempts += 1;
      return { rows: [{ locked: false }] };
    },
  };

  await assert.rejects(
    withMigrationLock(
      client,
      async () => {
        applied = true;
      },
      {
        timeoutMs: 25,
        pollIntervalMs: 10,
        now: () => currentTime,
        sleep: async (milliseconds) => {
          currentTime += milliseconds;
        },
      },
    ),
    /lock.*bezet|deployment.*later/i,
  );
  assert.equal(applied, false);
  assert.equal(currentTime, 1_025);
  assert.equal(attempts, 3);
  assert.equal(MIGRATION_LOCK_TIMEOUT_MS, 30_000);
});

test("migration lock never starts another query at the exact deadline", async () => {
  let currentTime = 0;
  let attempts = 0;
  const client = {
    async query(query) {
      assert.match(queryText(query), /pg_try_advisory_lock/);
      attempts += 1;
      currentTime = 10;
      return { rows: [{ locked: false }] };
    },
  };
  await assert.rejects(
    withMigrationLock(client, async () => undefined, {
      timeoutMs: 10,
      pollIntervalMs: 1,
      now: () => currentTime,
      sleep: async () => undefined,
    }),
    /lock.*bezet|deployment.*later/i,
  );
  assert.equal(attempts, 1);
});

test("a lock acquired at the deadline is released and never applied", async () => {
  let currentTime = 0;
  let applied = false;
  const events = [];
  const client = {
    async query(query) {
      const text = queryText(query);
      events.push(text);
      if (text.includes("pg_try_advisory_lock")) {
        currentTime = 10;
        return { rows: [{ locked: true }] };
      }
      return { rows: [{ unlocked: true }] };
    },
  };
  await assert.rejects(
    withMigrationLock(
      client,
      async () => {
        applied = true;
      },
      {
        timeoutMs: 10,
        pollIntervalMs: 1,
        unlockTimeoutMs: 20,
        now: () => currentTime,
      },
    ),
    /lock.*bezet|deployment.*later/i,
  );
  assert.equal(applied, false);
  assert.deepEqual(events, [
    "select pg_try_advisory_lock($1::bigint) as locked",
    "select pg_advisory_unlock($1::bigint) as unlocked",
  ]);
});

test("never-resolving acquire and unlock queries are bounded", async () => {
  const acquireStartedAt = performance.now();
  await assert.rejects(
    withMigrationLock(
      { query: () => new Promise(() => undefined) },
      async () => undefined,
      { timeoutMs: 20, unlockTimeoutMs: 20 },
    ),
    /lock.*duurde te lang/i,
  );
  assert.ok(performance.now() - acquireStartedAt < 500);

  const primary = new Error("primaire migratiefout");
  const client = {
    query(query) {
      return queryText(query).includes("pg_try_advisory_lock")
        ? Promise.resolve({ rows: [{ locked: true }] })
        : new Promise(() => undefined);
    },
  };
  const unlockStartedAt = performance.now();
  await assert.rejects(
    withMigrationLock(
      client,
      async () => {
        throw primary;
      },
      { timeoutMs: 100, unlockTimeoutMs: 20 },
    ),
    (error) => error === primary,
  );
  assert.ok(performance.now() - unlockStartedAt < 500);
  await assert.rejects(
    withMigrationLock(client, async () => undefined, {
      timeoutMs: 100,
      unlockTimeoutMs: 20,
    }),
    /lock.*niet tijdig.*vrijgegeven/i,
  );
});

test("one dedicated connection owns connect, lock, apply, unlock and close", async () => {
  const events = [];
  class Client {
    constructor(options) {
      events.push({ event: "construct", options, client: this });
    }
    async connect() {
      events.push({ event: "connect", client: this });
    }
    async query(query) {
      const text = queryText(query);
      events.push({ event: text, client: this });
      return {
        rows: text.includes("pg_try_advisory_lock")
          ? [{ locked: true }]
          : text.includes("pg_advisory_unlock")
            ? [{ unlocked: true }]
            : [],
      };
    }
    async end() {
      events.push({ event: "end", client: this });
    }
  }

  await withDedicatedMigrationClient(
    { Client },
    "postgresql://migration-user:migration-secret@direct.example.test/volt",
    (client) =>
      withMigrationLock(client, async () => {
        events.push({ event: "apply", client });
      }),
  );

  assert.deepEqual(
    events.map(({ event }) => event),
    [
      "construct",
      "connect",
      "select pg_try_advisory_lock($1::bigint) as locked",
      "apply",
      "select pg_advisory_unlock($1::bigint) as unlocked",
      "end",
    ],
  );
  const constructedClient = events[0].client;
  for (const event of events.slice(1)) {
    assert.equal(event.client, constructedClient, event.event);
  }
  assert.equal(events[0].options.application_name, "volt-migrator");
});

const postgresTestUrl = process.env.TEST_MIGRATION_DATABASE_URL?.trim();

function timeout(promise, milliseconds, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}

function realTestClient(pg, directUrl, suffix) {
  return new pg.Client({
    connectionString: directUrl,
    application_name: `volt-migration-test-${suffix}`,
    connectionTimeoutMillis: 5_000,
    query_timeout: 5_000,
    statement_timeout: 5_000,
  });
}

function forceDestroyClient(client) {
  try {
    client?.connection?.stream?.destroy();
  } catch {
    // Best-effort last resort after the public close timeout elapsed.
  }
}

async function closeRealTestClient(client) {
  if (!client) return;
  const closing = Promise.resolve().then(() => client.end());
  try {
    await timeout(closing, 1_000, "PostgreSQL-testclient sloot niet tijdig");
  } catch {
    forceDestroyClient(client);
    await timeout(
      closing.catch(() => undefined),
      1_000,
      "PostgreSQL-testclient bleef hangen na socket-close",
    ).catch(() => undefined);
  }
}

async function settleRunsOrDestroy(runs, clients) {
  const settled = Promise.allSettled(runs);
  try {
    await timeout(settled, 6_000, "PostgreSQL-testruns sloten niet tijdig af");
  } catch {
    for (const client of clients) forceDestroyClient(client);
    await timeout(
      settled,
      1_000,
      "PostgreSQL-testruns bleven hangen na socket-close",
    ).catch(() => undefined);
  }
}

function observeRun(promise) {
  void promise.catch(() => undefined);
  return promise;
}

test(
  "a real PostgreSQL session holds and releases the advisory lock",
  {
    skip: postgresTestUrl ? false : "TEST_MIGRATION_DATABASE_URL ontbreekt",
    timeout: 30_000,
  },
  async () => {
    const pg = (await import("pg")).default;
    const directUrl = resolveMigrationDatabaseUrl({
      MIGRATION_DATABASE_URL: postgresTestUrl,
    });
    const client = realTestClient(pg, directUrl, "lifecycle");
    try {
      await timeout(
        client.connect(),
        6_000,
        "PostgreSQL-testclient kon niet verbinden",
      );
      await withMigrationLock(client, async () => {
        const held = await client.query(
          `select exists (
            select 1 from pg_locks
            where locktype = 'advisory'
              and pid = pg_backend_pid()
              and granted
          ) as held`,
        );
        assert.equal(held.rows[0]?.held, true);
      });
      const released = await client.query(
        `select exists (
          select 1 from pg_locks
          where locktype = 'advisory'
            and pid = pg_backend_pid()
            and granted
        ) as held`,
      );
      assert.equal(released.rows[0]?.held, false);
    } finally {
      await closeRealTestClient(client);
    }
  },
);

test(
  "two real PostgreSQL migration sessions serialize on the advisory lock",
  {
    skip: postgresTestUrl ? false : "TEST_MIGRATION_DATABASE_URL ontbreekt",
    timeout: 40_000,
  },
  async () => {
    const pg = (await import("pg")).default;
    const directUrl = resolveMigrationDatabaseUrl({
      MIGRATION_DATABASE_URL: postgresTestUrl,
    });
    const firstClient = realTestClient(pg, directUrl, "concurrency-first");
    const secondClient = realTestClient(pg, directUrl, "concurrency-second");
    let releaseFirst;
    let markFirstEntered;
    let secondEntered = false;
    const firstEntered = new Promise((resolve) => {
      markFirstEntered = resolve;
    });
    const firstRelease = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    let firstRun = Promise.resolve();
    let secondRun = Promise.resolve();

    try {
      await timeout(
        Promise.all([firstClient.connect(), secondClient.connect()]),
        6_000,
        "PostgreSQL-concurrencyclients konden niet verbinden",
      );
      firstRun = observeRun(
        withMigrationLock(firstClient, async () => {
          markFirstEntered();
          await firstRelease;
        }),
      );
      await timeout(
        firstEntered,
        5_000,
        "eerste migratiesessie kreeg geen lock",
      );
      secondRun = observeRun(
        withMigrationLock(secondClient, async () => {
          secondEntered = true;
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.equal(secondEntered, false);
      releaseFirst();
      await timeout(
        Promise.all([firstRun, secondRun]),
        5_000,
        "migratiesessies liepen niet door na lockvrijgave",
      );
      assert.equal(secondEntered, true);
    } finally {
      releaseFirst?.();
      await settleRunsOrDestroy(
        [firstRun, secondRun],
        [firstClient, secondClient],
      );
      await Promise.all([
        closeRealTestClient(firstClient),
        closeRealTestClient(secondClient),
      ]);
    }
  },
);

test(
  "a real PostgreSQL contender fails within the migration lock deadline",
  {
    skip: postgresTestUrl ? false : "TEST_MIGRATION_DATABASE_URL ontbreekt",
    timeout: 30_000,
  },
  async () => {
    const pg = (await import("pg")).default;
    const directUrl = resolveMigrationDatabaseUrl({
      MIGRATION_DATABASE_URL: postgresTestUrl,
    });
    const holder = realTestClient(pg, directUrl, "timeout-holder");
    const contender = realTestClient(pg, directUrl, "timeout-contender");
    let releaseHolder;
    let markHolderEntered;
    let contenderEntered = false;
    const holderEntered = new Promise((resolve) => {
      markHolderEntered = resolve;
    });
    const holderRelease = new Promise((resolve) => {
      releaseHolder = resolve;
    });
    let holderRun = Promise.resolve();

    try {
      await timeout(
        Promise.all([holder.connect(), contender.connect()]),
        6_000,
        "PostgreSQL-timeoutclients konden niet verbinden",
      );
      holderRun = observeRun(
        withMigrationLock(holder, async () => {
          markHolderEntered();
          await holderRelease;
        }),
      );
      await timeout(
        holderEntered,
        5_000,
        "PostgreSQL-timeouthouder kreeg geen lock",
      );

      const startedAt = Date.now();
      await assert.rejects(
        withMigrationLock(
          contender,
          async () => {
            contenderEntered = true;
          },
          { timeoutMs: 250, pollIntervalMs: 25 },
        ),
        /lock.*bezet|deployment.*later/i,
      );
      const elapsed = Date.now() - startedAt;
      assert.equal(contenderEntered, false);
      assert.ok(elapsed >= 200, `locktimeout was te kort: ${elapsed}ms`);
      assert.ok(elapsed < 2_000, `locktimeout duurde te lang: ${elapsed}ms`);
    } finally {
      releaseHolder?.();
      await settleRunsOrDestroy([holderRun], [holder]);
      await Promise.all([
        closeRealTestClient(holder),
        closeRealTestClient(contender),
      ]);
    }
  },
);
