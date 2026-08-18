import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import pg from "pg";
import {
  assertMigrationSearchPath,
  isKnownPooledPostgresUrl,
  MIGRATION_STATEMENT_LOCK_TIMEOUT_MS,
  resolveMigrationDatabaseUrl,
  withDedicatedMigrationClient,
} from "./migration-database.mjs";

const DIRECT_URL = "postgresql://user:secret@ep-direct.example.test/volt";
const AMBIENT_PG_ENVIRONMENT = {
  PGAPPNAME: "ambient-app-secret",
  PGBINARY: "true",
  PGCLIENT_ENCODING: "ambient-encoding-secret",
  PGCLIENTENCODING: "LATIN1",
  PGCONNECT_TIMEOUT: "13",
  PGDATABASE: "ambient_database_secret",
  PGHOST: "ambient-host-secret.example",
  PGOPTIONS: "-c search_path=ambient_schema_secret",
  PGPASSFILE: "/ambient/passfile-secret.conf",
  PGPASSWORD: "ambient-password-secret",
  PGPORT: "6543",
  PGREPLICATION: "database",
  PGSERVICE: "ambient-service-secret",
  PGSERVICEFILE: "/ambient/service-secret.conf",
  PGSSLMODE: "disable",
  PGSSLNEGOTIATION: "ambient-negotiation-secret",
  PGUSER: "ambient-user-secret",
};

test("migrations select only the explicit direct URL", () => {
  assert.equal(
    resolveMigrationDatabaseUrl({
      DATABASE_URL:
        "postgresql://user:secret@ep-runtime-pooler.example.test/volt",
      MIGRATION_DATABASE_URL: DIRECT_URL,
      VERCEL: "1",
      NODE_ENV: "production",
    }),
    DIRECT_URL,
  );
});

test("the standard unpooled integration URL is accepted as a direct fallback", () => {
  assert.equal(
    resolveMigrationDatabaseUrl({
      DATABASE_URL: "postgresql://runtime-pooler.example.test/volt",
      DATABASE_URL_UNPOOLED: DIRECT_URL,
      VERCEL: "1",
    }),
    DIRECT_URL,
  );
});

test("matching direct URL variables are accepted after trimming", () => {
  assert.equal(
    resolveMigrationDatabaseUrl({
      MIGRATION_DATABASE_URL: ` ${DIRECT_URL} `,
      DATABASE_URL_UNPOOLED: DIRECT_URL,
    }),
    DIRECT_URL,
  );
});

test("a missing options parameter equals the pinned public search_path", () => {
  assert.equal(
    resolveMigrationDatabaseUrl({
      MIGRATION_DATABASE_URL: DIRECT_URL,
      DATABASE_URL_UNPOOLED: `${DIRECT_URL}?options=-c%20search_path%3Dpublic`,
    }),
    DIRECT_URL,
  );
});

test("direct URL aliases compare semantically without dropping connection options", () => {
  const first =
    "postgres://user:secret@direct.example.test:5432/volt?sslmode=require&application_name=migrator";
  const reordered =
    "postgresql://user:secret@direct.example.test/volt?application_name=migrator&sslmode=require";
  assert.equal(
    resolveMigrationDatabaseUrl({
      MIGRATION_DATABASE_URL: first,
      DATABASE_URL_UNPOOLED: reordered,
    }),
    first,
  );
  assert.throws(
    () =>
      resolveMigrationDatabaseUrl({
        MIGRATION_DATABASE_URL: first,
        DATABASE_URL_UNPOOLED: reordered.replace(
          "sslmode=require",
          "sslmode=disable",
        ),
      }),
    /verschillen/i,
  );
});

test("direct URL aliases use the pg path database and only allow a matching query hint", () => {
  const first =
    "postgresql://user:secret@direct.example.test/volt?database=old&database=volt&sslmode=require";
  const equivalent =
    "postgres://user:secret@direct.example.test/volt?sslmode=require&database=volt";
  assert.equal(
    resolveMigrationDatabaseUrl({
      MIGRATION_DATABASE_URL: first,
      DATABASE_URL_UNPOOLED: equivalent,
    }),
    first,
  );
  assert.throws(
    () =>
      resolveMigrationDatabaseUrl({
        MIGRATION_DATABASE_URL: first,
        DATABASE_URL_UNPOOLED:
          "postgresql://user:secret@direct.example.test/other?database=other&sslmode=require",
      }),
    /verschillen/i,
  );
  assert.throws(
    () =>
      resolveMigrationDatabaseUrl({
        MIGRATION_DATABASE_URL:
          "postgresql://user:very-secret@direct.example.test/volt?database=other",
      }),
    (error) => {
      assert.match(error.message, /database-queryparameter.*databasepad/i);
      assert.doesNotMatch(error.message, /very-secret|direct\.example|other/);
      return true;
    },
  );
});

test("conflicting direct URL variables fail before connecting without leaking credentials", () => {
  const first = "postgresql://first-user:first-secret@one.example.test/volt";
  const second = "postgresql://second-user:second-secret@two.example.test/volt";
  assert.throws(
    () =>
      resolveMigrationDatabaseUrl({
        MIGRATION_DATABASE_URL: first,
        DATABASE_URL_UNPOOLED: second,
      }),
    (error) => {
      assert.match(error.message, /MIGRATION_DATABASE_URL/);
      assert.match(error.message, /DATABASE_URL_UNPOOLED/);
      assert.doesNotMatch(error.message, /first-secret|second-secret/);
      assert.doesNotMatch(error.message, /one\.example|two\.example/);
      return true;
    },
  );
});

test("a runtime DATABASE_URL is never silently reused for migrations", () => {
  assert.throws(
    () =>
      resolveMigrationDatabaseUrl({
        DATABASE_URL: DIRECT_URL,
        NODE_ENV: "development",
      }),
    /MIGRATION_DATABASE_URL.*DATABASE_URL_UNPOOLED.*verplicht.*directe\/unpooled/i,
  );
});

test("migration URLs require an explicit non-empty database path", async () => {
  for (const url of [
    "postgresql://fallback-user:fallback-secret@direct.example.test",
    "postgresql://fallback-user:fallback-secret@direct.example.test/?database=fallback-user",
  ]) {
    assert.throws(
      () => resolveMigrationDatabaseUrl({ MIGRATION_DATABASE_URL: url }),
      (error) => {
        assert.match(error.message, /expliciete databasenaam.*URL-pad/i);
        assert.doesNotMatch(
          error.message,
          /fallback-user|fallback-secret|direct\.example/i,
        );
        return true;
      },
    );
    let constructed = false;
    await assert.rejects(
      withDedicatedMigrationClient(
        {
          Client: class {
            constructor() {
              constructed = true;
            }
          },
        },
        url,
        async () => undefined,
      ),
      /expliciete databasenaam.*URL-pad/i,
    );
    assert.equal(constructed, false);
  }
});

test("migration URLs require explicit credentials before constructing a client", async () => {
  const urls = [
    "postgresql://direct.example.test/volt",
    "postgresql://explicit-user@direct.example.test/volt",
    "postgresql://:explicit-password@direct.example.test/volt",
  ];
  for (const url of urls) {
    assert.throws(
      () =>
        resolveMigrationDatabaseUrl({
          MIGRATION_DATABASE_URL: url,
          USER: "ambient-operating-system-user",
          HOME: "/ambient/home-with-pgpass",
        }),
      (error) => {
        assert.match(
          error.message,
          /expliciete databasegebruiker|databasewachtwoord/i,
        );
        assert.doesNotMatch(
          error.message,
          /ambient-operating-system-user|ambient\/home|direct\.example/i,
        );
        return true;
      },
    );
    let constructed = false;
    await assert.rejects(
      withDedicatedMigrationClient(
        {
          Client: class {
            constructor() {
              constructed = true;
            }
          },
        },
        url,
        async () => undefined,
      ),
      /expliciete databasegebruiker|databasewachtwoord/i,
    );
    assert.equal(constructed, false);
  }
});

test("migration URLs reject external pg timeout config before constructing a client", async () => {
  const cases = [
    {
      query: "statement_timeout=7654",
      property: "statement_timeout",
      expected: "7654",
    },
    {
      query: "query_timeout=7654",
      property: "query_timeout",
      expected: "7654",
    },
    {
      query: "lock_timeout=7654",
      property: "lock_timeout",
      expected: "7654",
    },
    {
      query: "statement_timeout=1&statement_timeout=7654",
      property: "statement_timeout",
      expected: "7654",
    },
    {
      query: "%73tatement_timeout=7654",
      property: "statement_timeout",
      expected: "7654",
    },
  ];

  for (const { query, property, expected } of cases) {
    const url = `postgresql://user:timeout-secret@direct.example.test/volt?${query}`;
    const installedClient = new pg.Client({ connectionString: url });
    assert.equal(installedClient.connectionParameters[property], expected);

    let constructed = false;
    await assert.rejects(
      withDedicatedMigrationClient(
        {
          Client: class {
            constructor() {
              constructed = true;
            }
          },
        },
        url,
        async () => undefined,
      ),
      (error) => {
        assert.match(error.message, /statement-.*query-.*lock-time-out/i);
        assert.doesNotMatch(
          error.message,
          /timeout-secret|direct\.example|7654/i,
        );
        return true;
      },
    );
    assert.equal(constructed, false);
  }
});

test("all encoded, duplicate and malformed statement_timeout options fail closed", async () => {
  const optionQueries = [
    `options=${encodeURIComponent("-c statement_timeout=7654")}`,
    `options=${encodeURIComponent("-cstatement_timeout=7654")}`,
    `options=${encodeURIComponent("--statement_timeout=7654")}`,
    `options=${encodeURIComponent("statement_timeout=7654")}`,
    `options=${encodeURIComponent('-c "statement_timeout=7654"')}`,
    `options=${encodeURIComponent("-c statement_timeout = 7654")}`,
    `options=${encodeURIComponent("-c state\\ment_timeout=7654")}`,
    `options=${encodeURIComponent('-c state"ment"_timeout=7654')}`,
    `options=${encodeURIComponent("-c lock_timeout=7654")}`,
    `options=${encodeURIComponent("-c query_timeout=7654")}`,
    "options=-c%20%73tatement_timeout%3D7654",
    "options=%E0%A4%A%20-c%20statement_timeout%3D7654",
    `options=${encodeURIComponent("-c statement_timeout")}`,
    `options=${encodeURIComponent("-c statement_timeout=7654")}&options=${encodeURIComponent("-c search_path=public")}`,
    `options=${encodeURIComponent("-c search_path=public")}&options=${encodeURIComponent("-c statement_timeout=7654")}`,
  ];

  for (const query of optionQueries) {
    const url = `postgresql://user:options-secret@direct.example.test/volt?${query}`;
    const installedClient = new pg.Client({ connectionString: url });
    assert.equal(typeof installedClient.connectionParameters.options, "string");

    let constructed = false;
    await assert.rejects(
      withDedicatedMigrationClient(
        {
          Client: class {
            constructor() {
              constructed = true;
            }
          },
        },
        url,
        async () => undefined,
      ),
      (error) => {
        assert.match(error.message, /statement-.*query-.*lock-time-out/i);
        assert.doesNotMatch(
          error.message,
          /options-secret|direct\.example|7654/i,
        );
        return true;
      },
    );
    assert.equal(constructed, false);
  }
});

test("ambient USER and HOME pgpass cannot supply missing migration credentials", async () => {
  const ambientHome = await mkdtemp(join(tmpdir(), "volt-migration-home-"));
  const pgpassPath = join(ambientHome, ".pgpass");
  await writeFile(
    pgpassPath,
    "direct.example.test:5432:volt:ambient-user:ambient-pgpass-secret\n",
    { mode: 0o600 },
  );
  const childSource = String.raw`
    import assert from "node:assert/strict";
    import { createRequire } from "node:module";
    import pg from "pg";
    import { resolveMigrationDatabaseUrl } from "./scripts/migration-database.mjs";

    const require = createRequire(import.meta.url);
    const pgpassHelper = require("pgpass/lib/helper.js");
    const url = "postgresql://direct.example.test/volt";
    const rawClient = new pg.Client({ connectionString: url });
    assert.equal(rawClient.user, "ambient-user");
    assert.equal(rawClient.password, null);
    assert.equal(pgpassHelper.getFileName(), process.env.HOME + "/.pgpass");
    assert.throws(
      () => resolveMigrationDatabaseUrl({ MIGRATION_DATABASE_URL: url }),
      /expliciete databasegebruiker/i,
    );
  `;
  try {
    const environment = { ...process.env };
    for (const key of Object.keys(AMBIENT_PG_ENVIRONMENT)) {
      delete environment[key];
    }
    environment.USER = "ambient-user";
    environment.HOME = ambientHome;
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", childSource],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 5_000,
        env: environment,
      },
    );
    assert.equal(
      result.status,
      0,
      `ambient credential-subprocess faalde:\n${result.stdout}\n${result.stderr}`,
    );
    assert.doesNotMatch(
      `${result.stdout}\n${result.stderr}`,
      /ambient-pgpass-secret|direct\.example/i,
    );
  } finally {
    await rm(ambientHome, { recursive: true, force: true });
  }
});

test("migration URLs reject case-sensitive Unix socket hosts before connecting", async () => {
  const socketUrls = ["/var/run/postgresql", "/VAR/RUN/PostgreSQL"].flatMap(
    (socketPath) => [
      `postgresql://user:socket-secret@direct.example.test/volt?host=${encodeURIComponent(socketPath)}`,
      `postgresql://user:socket-secret@${encodeURIComponent(socketPath)}/volt`,
    ],
  );
  for (const url of socketUrls) {
    assert.throws(
      () => resolveMigrationDatabaseUrl({ MIGRATION_DATABASE_URL: url }),
      (error) => {
        assert.match(error.message, /TCP-databasehost|Unix-sockets/i);
        assert.doesNotMatch(
          error.message,
          /socket-secret|direct\.example|var\/run|VAR\/RUN/i,
        );
        return true;
      },
    );
    let constructed = false;
    await assert.rejects(
      withDedicatedMigrationClient(
        {
          Client: class {
            constructor() {
              constructed = true;
            }
          },
        },
        url,
        async () => undefined,
      ),
      /TCP-databasehost|Unix-sockets/i,
    );
    assert.equal(constructed, false);
  }
});

test("ambient pg connection variables fail closed without leaking values", () => {
  for (const [key, ambientValue] of Object.entries(AMBIENT_PG_ENVIRONMENT)) {
    assert.throws(
      () =>
        resolveMigrationDatabaseUrl({
          MIGRATION_DATABASE_URL: DIRECT_URL,
          [key]: ambientValue,
        }),
      (error) => {
        assert.match(error.message, new RegExp(key));
        assert.doesNotMatch(error.message, new RegExp(ambientValue));
        assert.doesNotMatch(error.message, /user:secret|ep-direct/i);
        return true;
      },
      key,
    );
  }
  assert.throws(
    () =>
      resolveMigrationDatabaseUrl({
        MIGRATION_DATABASE_URL: DIRECT_URL,
        PGDATABASE: " ",
      }),
    /PGDATABASE/,
  );
});

test("installed pg ambient fallbacks are rejected by the resolver before any connection", () => {
  const childSource = String.raw`
    import assert from "node:assert/strict";
    import pg from "pg";
    import { resolveMigrationDatabaseUrl } from "./scripts/migration-database.mjs";

    const key = process.env.AMBIENT_TEST_KEY;
    const value = process.env[key];
    const connectionString = key === "PGDATABASE"
      ? "postgresql://user:connection-secret@direct.example.test"
      : "postgresql://user:connection-secret@direct.example.test/volt";
    const installedClient = new pg.Client({ connectionString });
    if (key === "PGPORT") assert.equal(installedClient.port, 6543);
    if (key === "PGDATABASE") assert.equal(installedClient.database, value);
    if (key === "PGOPTIONS") {
      assert.equal(installedClient.connectionParameters.options, value);
    }
    assert.throws(
      () => resolveMigrationDatabaseUrl({
        MIGRATION_DATABASE_URL: connectionString,
        [key]: value,
      }),
      (error) => {
        assert.match(error.message, new RegExp(key));
        assert.doesNotMatch(error.message, new RegExp(value));
        assert.doesNotMatch(error.message, /connection-secret|direct\\.example/);
        return true;
      },
    );
  `;

  for (const key of ["PGPORT", "PGDATABASE", "PGOPTIONS"]) {
    const cleanEnvironment = { ...process.env };
    for (const ambientKey of Object.keys(AMBIENT_PG_ENVIRONMENT)) {
      cleanEnvironment[ambientKey] = "";
    }
    cleanEnvironment.AMBIENT_TEST_KEY = key;
    cleanEnvironment[key] = AMBIENT_PG_ENVIRONMENT[key];
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", childSource],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 5_000,
        env: cleanEnvironment,
      },
    );
    assert.equal(
      result.status,
      0,
      `${key} subprocess faalde:\n${result.stdout}\n${result.stderr}`,
    );
    assert.doesNotMatch(
      `${result.stdout}\n${result.stderr}`,
      /ENOTFOUND|ECONNREFUSED|ETIMEDOUT/,
    );
  }
});

test("the migration executable rejects ambient pg fallbacks before network access", () => {
  for (const key of ["PGPORT", "PGDATABASE", "PGOPTIONS"]) {
    const cleanEnvironment = { ...process.env };
    for (const ambientKey of Object.keys(AMBIENT_PG_ENVIRONMENT)) {
      cleanEnvironment[ambientKey] = "";
    }
    cleanEnvironment.DATABASE_URL = "";
    cleanEnvironment.DATABASE_URL_UNPOOLED = "";
    cleanEnvironment.MIGRATION_DATABASE_URL = DIRECT_URL;
    cleanEnvironment.NODE_ENV = "test";
    cleanEnvironment.VERCEL = "";
    cleanEnvironment.NETLIFY = "";
    cleanEnvironment.REQUIRE_DATABASE = "";
    cleanEnvironment[key] = AMBIENT_PG_ENVIRONMENT[key];
    const result = spawnSync(process.execPath, ["scripts/migrate.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 5_000,
      env: cleanEnvironment,
    });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.notEqual(result.status, 0, key);
    assert.match(output, new RegExp(key));
    assert.doesNotMatch(output, new RegExp(AMBIENT_PG_ENVIRONMENT[key]));
    assert.doesNotMatch(
      output,
      /user:secret|ep-direct|ambient_database_secret|ambient_schema_secret|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i,
    );
  }
});

test("Neon runtime pooler and direct migration URL must share branch and database", () => {
  const runtime =
    "postgresql://runtime-role:runtime-secret@ep-green-tree-pooler.eu-central-1.aws.neon.tech/volt?sslmode=require";
  const matchingDirect =
    "postgresql://migration-role:migration-secret@ep-green-tree.eu-central-1.aws.neon.tech/volt?sslmode=require";
  assert.equal(
    resolveMigrationDatabaseUrl({
      DATABASE_URL: runtime,
      MIGRATION_DATABASE_URL: matchingDirect,
    }),
    matchingDirect,
  );
  const matchingWithoutRedundantEndpointOption =
    "postgresql://migration-role:migration-secret@ep-green-tree.eu-central-1.aws.neon.tech/volt?database=volt";
  assert.equal(
    resolveMigrationDatabaseUrl({
      DATABASE_URL: runtime,
      MIGRATION_DATABASE_URL: matchingWithoutRedundantEndpointOption,
    }),
    matchingWithoutRedundantEndpointOption,
  );

  for (const mismatchedDirect of [
    "postgresql://migration-role:migration-secret@ep-other-tree.eu-central-1.aws.neon.tech/volt?sslmode=require",
    "postgresql://migration-role:migration-secret@ep-green-tree.eu-central-1.aws.neon.tech/other?sslmode=require",
  ]) {
    assert.throws(
      () =>
        resolveMigrationDatabaseUrl({
          DATABASE_URL: runtime,
          MIGRATION_DATABASE_URL: mismatchedDirect,
        }),
      (error) => {
        assert.match(error.message, /dezelfde Neon-branch en database/i);
        assert.doesNotMatch(
          error.message,
          /runtime-secret|migration-secret|ep-green-tree|ep-other-tree/i,
        );
        return true;
      },
    );
  }
});

test("trailing-dot Neon hosts still enforce branch identity", () => {
  const runtime =
    "postgresql://runtime:runtime-secret@ep-first-pooler.eu-central-1.aws.neon.tech./volt";
  const migration =
    "postgresql://migration:migration-secret@ep-second.eu-central-1.aws.neon.tech./volt";
  assert.throws(
    () =>
      resolveMigrationDatabaseUrl({
        DATABASE_URL: runtime,
        MIGRATION_DATABASE_URL: migration,
      }),
    (error) => {
      assert.match(error.message, /dezelfde Neon-branch en database/i);
      assert.doesNotMatch(
        error.message,
        /runtime-secret|migration-secret|ep-first|ep-second/i,
      );
      return true;
    },
  );
});

test("Neon identity uses pg's path database and normalized endpoint options", () => {
  const runtime =
    "postgresql://runtime-role:runtime-secret@ep-green-tree-pooler.eu-central-1.aws.neon.tech/volt?database=old&database=volt&options=endpoint%3Dep-green-tree-pooler";
  const matchingDirect =
    "postgresql://migration-role:migration-secret@ep-green-tree.eu-central-1.aws.neon.tech/volt?options=endpoint%3Dep-green-tree&database=volt";
  assert.equal(
    resolveMigrationDatabaseUrl({
      DATABASE_URL: runtime,
      MIGRATION_DATABASE_URL: matchingDirect,
    }),
    matchingDirect,
  );

  for (const mismatchedDirect of [
    matchingDirect
      .replace("/volt?", "/other?")
      .replace("database=volt", "database=other"),
    matchingDirect.replace("endpoint%3Dep-green-tree", "endpoint%3Dep-other"),
  ]) {
    assert.throws(
      () =>
        resolveMigrationDatabaseUrl({
          DATABASE_URL: runtime,
          MIGRATION_DATABASE_URL: mismatchedDirect,
        }),
      (error) => {
        assert.match(error.message, /dezelfde Neon-branch en database/i);
        assert.doesNotMatch(
          error.message,
          /runtime-secret|migration-secret|ep-green-tree|ep-other/i,
        );
        return true;
      },
    );
  }
});

test("malformed Neon endpoint options fail without leaking the URL", () => {
  const runtime =
    "postgresql://runtime-role:runtime-secret@ep-green-tree-pooler.eu-central-1.aws.neon.tech/volt";
  const malformed =
    "postgresql://migration-role:migration-secret@ep-green-tree.eu-central-1.aws.neon.tech/volt?options=endpoint%3Dnot-a-neon-endpoint";
  assert.throws(
    () =>
      resolveMigrationDatabaseUrl({
        DATABASE_URL: runtime,
        MIGRATION_DATABASE_URL: malformed,
      }),
    (error) => {
      assert.match(error.message, /ongeldige Neon endpoint-optie/i);
      assert.doesNotMatch(
        error.message,
        /runtime-secret|migration-secret|ep-green-tree|not-a-neon/i,
      );
      return true;
    },
  );
});

test("a Neon URL cannot be paired with an unverifiable non-Neon URL", () => {
  const neonRuntime =
    "postgresql://runtime-role:runtime-secret@ep-green-tree-pooler.eu-central-1.aws.neon.tech/volt";
  const neonMigration =
    "postgresql://migration-role:migration-secret@ep-green-tree.eu-central-1.aws.neon.tech/volt";
  const otherProvider =
    "postgresql://migration-role:other-secret@direct.database.example/volt";

  for (const [runtimeUrl, migrationUrl] of [
    [neonRuntime, otherProvider],
    [otherProvider, neonMigration],
  ]) {
    assert.throws(
      () =>
        resolveMigrationDatabaseUrl({
          DATABASE_URL: runtimeUrl,
          MIGRATION_DATABASE_URL: migrationUrl,
        }),
      (error) => {
        assert.match(error.message, /dezelfde Neon-branch en database/i);
        assert.doesNotMatch(
          error.message,
          /runtime-secret|migration-secret|other-secret|ep-green-tree/i,
        );
        return true;
      },
    );
  }
});

test("known Neon, Supabase and query-parameter poolers fail closed", () => {
  const pooledUrls = [
    "postgresql://user:secret@ep-name-pooler.eu.neon.tech/volt",
    "postgresql://user:secret@aws-0-eu.pooler.supabase.com/volt",
    "postgresql://user:secret@database.example.test/volt?pgbouncer=true",
    "postgresql://user:secret@database.example.test/volt?pgbouncer=false&pgbouncer=true",
    "postgresql://user:secret@database.example.test/volt?connection_pooling=false&connection_pooling=true",
    "postgresql://user:secret@database.example.test:6543/volt",
    "postgresql://user:secret@database.example.test/volt?port=6543",
    "postgresql://user:secret@database.example.test/volt?port=06543",
    "postgresql://user:secret@ep-name.eu.neon.tech/volt?options=endpoint%3Dep-name-pooler",
  ];
  for (const url of pooledUrls) {
    assert.equal(isKnownPooledPostgresUrl(url), true, url);
    assert.throws(
      () => {
        resolveMigrationDatabaseUrl({ MIGRATION_DATABASE_URL: url });
      },
      (error) => {
        assert.match(error.message, /pooled|PgBouncer|directe\/unpooled/i);
        assert.doesNotMatch(error.message, /user:secret/);
        return true;
      },
    );
  }
  assert.equal(
    isKnownPooledPostgresUrl(
      "postgresql://user:secret@database.example.test/volt?pgbouncer=true&pgbouncer=false",
    ),
    false,
  );
});

test("malformed query ports fail before connecting without leaking the URL", () => {
  for (const port of ["6543x", "5432.5", "-1", "65536"]) {
    assert.throws(
      () =>
        resolveMigrationDatabaseUrl({
          MIGRATION_DATABASE_URL: `postgresql://user:port-secret@direct.example.test/volt?port=${encodeURIComponent(port)}`,
        }),
      (error) => {
        assert.match(error.message, /ongeldige databasepoort/i);
        assert.doesNotMatch(error.message, /port-secret|direct\.example|6543x/);
        return true;
      },
    );
  }
});

test("a pooled Neon runtime option matches its direct migration endpoint identity", () => {
  const runtime =
    "postgresql://runtime:secret@ep-green-tree.eu-central-1.aws.neon.tech/volt?options=endpoint%3Dep-green-tree-pooler&sslmode=require";
  const migration =
    "postgresql://migrator:secret@ep-green-tree.eu-central-1.aws.neon.tech/volt?options=endpoint%3Dep-green-tree&sslmode=require";
  assert.equal(
    resolveMigrationDatabaseUrl({
      DATABASE_URL: runtime,
      MIGRATION_DATABASE_URL: migration,
    }),
    migration,
  );
  assert.equal(isKnownPooledPostgresUrl(runtime), true);
  assert.equal(isKnownPooledPostgresUrl(migration), false);
});

test("runtime and migration URLs must use the same effective search_path", () => {
  const runtime =
    "postgresql://runtime:runtime-secret@ep-green-tree-pooler.eu.neon.tech/volt?options=-c%20search_path%3Dshop_schema";
  const matchingMigration =
    "postgresql://migration:migration-secret@ep-green-tree.eu.neon.tech/volt?options=-csearch_path%3Dshop_schema";
  assert.equal(
    resolveMigrationDatabaseUrl({
      DATABASE_URL: runtime,
      MIGRATION_DATABASE_URL: matchingMigration,
    }),
    matchingMigration,
  );

  const mismatchedMigration =
    "postgresql://migration:migration-secret@ep-green-tree.eu.neon.tech/volt?options=-c%20search_path%3Dmigration_schema";
  assert.throws(
    () =>
      resolveMigrationDatabaseUrl({
        DATABASE_URL: runtime.replace("shop_schema", "runtime_schema"),
        MIGRATION_DATABASE_URL: mismatchedMigration,
      }),
    (error) => {
      assert.match(error.message, /dezelfde veilige search_path/i);
      assert.doesNotMatch(
        error.message,
        /runtime-secret|migration-secret|runtime_schema|migration_schema/i,
      );
      return true;
    },
  );

  assert.throws(
    () =>
      resolveMigrationDatabaseUrl({
        MIGRATION_DATABASE_URL:
          "postgresql://migration:migration-secret@direct.example.test/volt?options=-c%20search_path%3D%22Private%20Schema%22",
      }),
    (error) => {
      assert.match(error.message, /search_path|PostgreSQL-opties/i);
      assert.doesNotMatch(error.message, /migration-secret|Private|direct/i);
      return true;
    },
  );
});

test("migration search_path is verified on the connected session", async () => {
  const connectionString =
    "postgresql://migration:secret@direct.example.test/volt?options=-c%20search_path%3Dshop_schema";
  await assertMigrationSearchPath(
    {
      async query(query) {
        assert.match(query.text, /current_schema/i);
        assert.equal(query.query_timeout, 5_000);
        return { rows: [{ current_schema: "shop_schema" }] };
      },
    },
    connectionString,
  );
  await assert.rejects(
    assertMigrationSearchPath(
      {
        async query() {
          return { rows: [{ current_schema: "other_schema" }] };
        },
      },
      connectionString,
    ),
    (error) => {
      assert.match(error.message, /actieve search_path/i);
      assert.doesNotMatch(error.message, /shop_schema|other_schema|secret/);
      return true;
    },
  );
});

test("migration search_path preflight and dedicated cleanup stay bounded", async () => {
  const closeError = new Error("secundaire sluitfout");
  const events = [];
  let observedQuery;
  class Client {
    async connect() {
      events.push("connect");
    }
    query(query) {
      events.push("preflight");
      observedQuery = query;
      return new Promise(() => undefined);
    }
    async end() {
      events.push("end");
      throw closeError;
    }
  }

  const startedAt = performance.now();
  await assert.rejects(
    withDedicatedMigrationClient(
      { Client },
      DIRECT_URL,
      (client) => assertMigrationSearchPath(client, DIRECT_URL, 20),
      { connectTimeoutMs: 100, closeTimeoutMs: 20 },
    ),
    (error) => {
      assert.match(error.message, /search_path-preflight.*duurde te lang/i);
      assert.notEqual(error, closeError);
      return true;
    },
  );
  assert.ok(performance.now() - startedAt < 500);
  assert.deepEqual(events, ["connect", "preflight", "end"]);
  assert.equal(observedQuery.text, "select current_schema() as current_schema");
  assert.equal(observedQuery.query_timeout, 20);
});

test("migration URL validation rejects non-PostgreSQL and deployment gaps", () => {
  assert.throws(
    () => resolveMigrationDatabaseUrl({ MIGRATION_DATABASE_URL: "https://db" }),
    /postgres/i,
  );
  assert.throws(
    () =>
      resolveMigrationDatabaseUrl({
        MIGRATION_DATABASE_URL: DIRECT_URL,
        VERCEL: "1",
        NODE_ENV: "production",
      }),
    /DATABASE_URL.*runtime/i,
  );
  assert.throws(
    () => resolveMigrationDatabaseUrl({ VERCEL: "1", NODE_ENV: "production" }),
    /DATABASE_URL.*MIGRATION_DATABASE_URL/i,
  );
  assert.equal(resolveMigrationDatabaseUrl({ NODE_ENV: "development" }), null);
});

test("the executable fails before connecting when only DATABASE_URL is set", () => {
  const result = spawnSync(process.execPath, ["scripts/migrate.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_URL: DIRECT_URL,
      MIGRATION_DATABASE_URL: "",
      DATABASE_URL_UNPOOLED: "",
      NODE_ENV: "development",
      VERCEL: "",
      NETLIFY: "",
      REQUIRE_DATABASE: "",
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /MIGRATION_DATABASE_URL/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /ENOTFOUND|ECONN/);
});

test("dedicated client cleanup preserves the migration failure", async () => {
  const migrationError = new Error("primaire migratiefout");
  const closeError = new Error("secundaire sluitfout");
  const events = [];
  class Client {
    async connect() {
      events.push("connect");
    }
    async end() {
      events.push("end");
      throw closeError;
    }
  }

  await assert.rejects(
    withDedicatedMigrationClient({ Client }, DIRECT_URL, async () => {
      events.push("run");
      throw migrationError;
    }),
    (error) => error === migrationError,
  );
  assert.deepEqual(events, ["connect", "run", "end"]);
});

test("dedicated migration clients pin public or preserve explicit URL search_path", async () => {
  const observed = [];
  class Client {
    constructor(options) {
      observed.push(options);
    }
    async connect() {}
    async end() {}
  }
  for (const url of [
    DIRECT_URL,
    "postgresql://user:secret@ep-direct.example.test/volt?options=endpoint%3Dep-direct",
    "postgresql://user:secret@ep-direct.example.test/volt?options=-c%20search_path%3Dshop_schema",
  ]) {
    await withDedicatedMigrationClient({ Client }, url, async () => undefined);
  }
  assert.equal(observed[0].connectionString, DIRECT_URL);
  assert.equal(
    observed[0].options,
    `-c search_path=public -c lock_timeout=${MIGRATION_STATEMENT_LOCK_TIMEOUT_MS}`,
  );
  assert.doesNotMatch(observed[1].connectionString, /options=/);
  assert.equal(
    observed[1].options,
    `endpoint=ep-direct -c search_path=public -c lock_timeout=${MIGRATION_STATEMENT_LOCK_TIMEOUT_MS}`,
  );
  assert.doesNotMatch(observed[2].connectionString, /options=/);
  assert.equal(
    observed[2].options,
    `-c search_path=shop_schema -c lock_timeout=${MIGRATION_STATEMENT_LOCK_TIMEOUT_MS}`,
  );
  assert.ok(
    observed.every((options) => !/statement_timeout/i.test(options.options)),
  );
});

test("session lock-timeout initialization is bounded and fails closed before migration work", async () => {
  const startupError = new Error("ongeldige startupoptie");
  const events = [];
  let ran = false;
  class Client {
    constructor(options) {
      events.push("construct");
      assert.match(
        options.options,
        new RegExp(`lock_timeout=${MIGRATION_STATEMENT_LOCK_TIMEOUT_MS}`),
      );
      assert.doesNotMatch(options.options, /statement_timeout/i);
    }
    async connect() {
      events.push("connect");
      throw startupError;
    }
    async end() {
      events.push("end");
    }
  }

  await assert.rejects(
    withDedicatedMigrationClient({ Client }, DIRECT_URL, async () => {
      ran = true;
    }),
    (error) => error === startupError,
  );
  assert.equal(ran, false);
  assert.deepEqual(events, ["construct", "connect", "end"]);
});

test("resolver and dedicated client preserve the database interpreted by installed pg", async () => {
  let clientOptions;
  class Client {
    constructor(options) {
      clientOptions = options;
    }
    async connect() {}
    async end() {}
  }
  const runtime =
    "postgresql://runtime:runtime-secret@ep-green-tree-pooler.eu-central-1.aws.neon.tech/volt?database=volt&sslmode=require";
  const migration =
    "postgresql://migration:migration-secret@ep-green-tree.eu-central-1.aws.neon.tech/volt?sslmode=require&database=volt";
  const resolved = resolveMigrationDatabaseUrl({
    DATABASE_URL: runtime,
    MIGRATION_DATABASE_URL: migration,
  });
  await withDedicatedMigrationClient(
    { Client },
    resolved,
    async () => undefined,
  );

  assert.equal(clientOptions.connectionString, migration);
  assert.equal(
    clientOptions.options,
    `-c search_path=public -c lock_timeout=${MIGRATION_STATEMENT_LOCK_TIMEOUT_MS}`,
  );
  assert.equal(clientOptions.application_name, "volt-migrator");
  assert.equal(clientOptions.connectionTimeoutMillis, 10_000);

  const runtimePool = new pg.Pool({ connectionString: runtime });
  const runtimePoolClient = new runtimePool.Client(runtimePool.options);
  const migrationClient = new pg.Client({
    connectionString: clientOptions.connectionString,
  });
  const boundedMigrationClient = new pg.Client(clientOptions);
  try {
    assert.equal(runtimePool.options.connectionString, runtime);
    assert.equal(runtimePoolClient.database, "volt");
    assert.equal(migrationClient.database, runtimePoolClient.database);
    assert.equal(
      boundedMigrationClient.connectionParameters.options,
      clientOptions.options,
    );
    assert.equal(
      boundedMigrationClient.connectionParameters.statement_timeout,
      false,
    );
  } finally {
    await runtimePool.end();
  }
});

test("a conflicting database query fails before constructing or connecting", async () => {
  let constructed = false;
  const ambiguousUrl =
    "postgresql://user:connection-secret@direct.example.test/actual?database=other";
  const installedPgClient = new pg.Client({ connectionString: ambiguousUrl });
  const installedPgPool = new pg.Pool({ connectionString: ambiguousUrl });
  const installedPgPoolClient = new installedPgPool.Client(
    installedPgPool.options,
  );
  assert.equal(installedPgClient.database, "actual");
  assert.equal(installedPgPoolClient.database, "actual");
  await installedPgPool.end();
  class Client {
    constructor() {
      constructed = true;
    }
  }
  await assert.rejects(
    withDedicatedMigrationClient(
      { Client },
      ambiguousUrl,
      async () => undefined,
    ),
    (error) => {
      assert.match(error.message, /database-queryparameter.*databasepad/i);
      assert.doesNotMatch(
        error.message,
        /connection-secret|direct\.example|actual|other/,
      );
      return true;
    },
  );
  assert.equal(constructed, false);
});

test("dedicated client bounds a never-resolving connect and close", async () => {
  const events = [];
  class Client {
    connection = {
      stream: {
        destroy() {
          events.push("destroy");
        },
      },
    };
    connect() {
      events.push("connect");
      return new Promise(() => undefined);
    }
    end() {
      events.push("end");
      return new Promise(() => undefined);
    }
  }

  await assert.rejects(
    withDedicatedMigrationClient(
      { Client },
      DIRECT_URL,
      async () => undefined,
      { connectTimeoutMs: 20, closeTimeoutMs: 20 },
    ),
    /niet tijdig.*geopend/i,
  );
  assert.deepEqual(events, ["connect", "destroy", "end", "destroy"]);
});

test("dedicated client bounds close and preserves a primary migration error", async () => {
  const primary = new Error("primaire migratiefout");
  let destroys = 0;
  class Client {
    connection = {
      stream: {
        destroy() {
          destroys += 1;
        },
      },
    };
    async connect() {}
    end() {
      return new Promise(() => undefined);
    }
  }

  await assert.rejects(
    withDedicatedMigrationClient(
      { Client },
      DIRECT_URL,
      async () => {
        throw primary;
      },
      { connectTimeoutMs: 20, closeTimeoutMs: 20 },
    ),
    (error) => error === primary,
  );
  assert.equal(destroys, 1);

  await assert.rejects(
    withDedicatedMigrationClient({ Client }, DIRECT_URL, async () => "done", {
      connectTimeoutMs: 20,
      closeTimeoutMs: 20,
    }),
    /niet tijdig.*gesloten/i,
  );
  assert.equal(destroys, 2);
});

test("long migration work is not covered by connection lifecycle timeouts", async () => {
  class Client {
    async connect() {}
    async end() {}
  }
  const result = await withDedicatedMigrationClient(
    { Client },
    DIRECT_URL,
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return "done";
    },
    { connectTimeoutMs: 5, closeTimeoutMs: 5 },
  );
  assert.equal(result, "done");
});
