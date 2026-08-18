function value(environment, key) {
  return environment[key]?.trim() || null;
}

function enabled(environment, key) {
  const normalized = value(environment, key)?.toLowerCase();
  return normalized === "1" || normalized === "true";
}

function productionDatabaseRequired(environment) {
  const deployment =
    enabled(environment, "VERCEL") ||
    enabled(environment, "NETLIFY") ||
    enabled(environment, "REQUIRE_DATABASE");
  const localBuild =
    ["build", "db:migrate"].includes(
      value(environment, "npm_lifecycle_event") ?? "",
    ) && !deployment;
  return {
    deployment,
    required:
      deployment ||
      (value(environment, "NODE_ENV") === "production" && !localBuild),
  };
}

const AMBIENT_PG_CONNECTION_ENVIRONMENT = [
  "PGAPPNAME",
  "PGBINARY",
  "PGCLIENT_ENCODING",
  "PGCLIENTENCODING",
  "PGCONNECT_TIMEOUT",
  "PGDATABASE",
  "PGHOST",
  "PGOPTIONS",
  "PGPASSFILE",
  "PGPASSWORD",
  "PGPORT",
  "PGREPLICATION",
  "PGSERVICE",
  "PGSERVICEFILE",
  "PGSSLMODE",
  "PGSSLNEGOTIATION",
  "PGUSER",
];

export const MIGRATION_STATEMENT_LOCK_TIMEOUT_MS = 15_000;

function assertNoAmbientPgConnectionEnvironment(environment) {
  const configured = AMBIENT_PG_CONNECTION_ENVIRONMENT.filter(
    // node-postgres treats whitespace-only values as configured too.
    (key) => environment[key] != null && String(environment[key]).length > 0,
  );
  if (configured.length) {
    throw new Error(
      `Verwijder connection-affecting PostgreSQL-omgevingsvariabelen uit de migratoromgeving (${configured.join(", ")}); zet alle verbindingsinstellingen expliciet in de directe migratie-URL.`,
    );
  }
}

function parsePostgresUrl(rawUrl, variableName) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`${variableName} is geen geldige PostgreSQL-URL.`);
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error(
      `${variableName} moet postgres:// of postgresql:// gebruiken.`,
    );
  }
  if (!parsed.hostname) {
    throw new Error(`${variableName} mist een databasehost.`);
  }
  return parsed;
}

function assertExplicitMigrationCredentials(parsed, variableName) {
  const query = lastQueryValues(parsed);
  const user =
    query.get("user") || decodedUrlComponent(parsed.username, variableName);
  const password =
    query.get("password") || decodedUrlComponent(parsed.password, variableName);
  if (!user) {
    throw new Error(
      `${variableName} mist een expliciete databasegebruiker in de URL.`,
    );
  }
  if (!password) {
    throw new Error(
      `${variableName} mist een expliciet databasewachtwoord in de URL.`,
    );
  }
}

function lastQueryValues(parsed) {
  const values = new Map();
  for (const [key, value] of parsed.searchParams) values.set(key, value);
  return values;
}

const FORBIDDEN_MIGRATION_TIMEOUT_SETTINGS = new Set([
  "lock_timeout",
  "query_timeout",
  "statement_timeout",
]);
const FORBIDDEN_MIGRATION_OPTION_TIMEOUT =
  /(?:lock_timeout|query_timeout|statement_timeout)/i;

function normalizedPostgresOptionsForPolicy(options, variableName) {
  let normalized = "";
  let quote = null;
  for (let index = 0; index < options.length; index += 1) {
    const character = options[index];
    if (character === "\\") {
      const escaped = options[index + 1];
      if (escaped === undefined) {
        throw new Error(`${variableName} bevat ongeldige PostgreSQL-opties.`);
      }
      normalized += escaped;
      index += 1;
    } else if (quote) {
      if (character === quote) quote = null;
      else normalized += character;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else {
      normalized += character;
    }
  }
  if (quote) {
    throw new Error(`${variableName} bevat ongeldige PostgreSQL-opties.`);
  }
  return normalized;
}

function assertNoExternalMigrationTimeouts(parsed, variableName) {
  for (const [rawName, rawValue] of parsed.searchParams) {
    const name = rawName.trim().toLowerCase();
    if (
      FORBIDDEN_MIGRATION_TIMEOUT_SETTINGS.has(name) ||
      (name === "options" &&
        FORBIDDEN_MIGRATION_OPTION_TIMEOUT.test(
          normalizedPostgresOptionsForPolicy(rawValue, variableName),
        ))
    ) {
      throw new Error(
        `${variableName} mag geen externe statement-, query- of lock-time-out instellen; de migrator begrenst uitsluitend het wachten op locks zelf.`,
      );
    }
  }
}

function normalizedPostgresHost(host) {
  return host.toLowerCase().replace(/\.+$/, "");
}

function normalizedPostgresPort(rawPort, variableName) {
  if (!rawPort) return 5432;
  if (!/^\d+$/.test(rawPort)) {
    throw new Error(`${variableName} bevat een ongeldige databasepoort.`);
  }
  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${variableName} bevat een ongeldige databasepoort.`);
  }
  return port;
}

function decodedUrlComponent(value, variableName) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(`${variableName} bevat ongeldige URL-encoding.`);
  }
}

function decodedDatabasePath(value, variableName) {
  try {
    // Match pg-connection-string: encoded path separators remain part of the
    // database name rather than being treated as literal separators.
    return decodeURI(value);
  } catch {
    throw new Error(`${variableName} bevat ongeldige URL-encoding.`);
  }
}

function normalizedSearchPath(rawSearchPath, variableName) {
  if (!rawSearchPath) return "public";
  const schemas = rawSearchPath.split(",").map((schema) => schema.trim());
  if (
    !schemas.length ||
    schemas.some((schema) => !schema || !/^[a-z_][a-z0-9_$]*$/i.test(schema))
  ) {
    throw new Error(
      `${variableName} bevat een onveilige of niet-ondersteunde search_path.`,
    );
  }
  return schemas.map((schema) => schema.toLowerCase()).join(",");
}

function postgresOptionSettings(options, variableName) {
  const tokens = options?.trim().split(/\s+/).filter(Boolean) ?? [];
  let endpoint = null;
  let searchPath = null;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    let assignment = null;
    if (token === "-c") {
      assignment = tokens[(index += 1)] ?? null;
    } else if (token.startsWith("-c")) {
      assignment = token.slice(2);
    } else if (token.startsWith("--")) {
      assignment = token.slice(2);
    } else if (/^endpoint=/i.test(token)) {
      // Neon also accepts its routing endpoint without a postgres `-c` flag.
      assignment = token;
    }
    if (assignment === null) continue;
    const separator = assignment.indexOf("=");
    if (separator < 1 || separator === assignment.length - 1) {
      throw new Error(`${variableName} bevat ongeldige PostgreSQL-opties.`);
    }
    const name = assignment.slice(0, separator).toLowerCase();
    const setting = assignment.slice(separator + 1);
    if (name === "endpoint") {
      if (!/^ep-[a-z0-9-]+$/i.test(setting)) {
        throw new Error(
          `${variableName} bevat een ongeldige Neon endpoint-optie.`,
        );
      }
      endpoint = setting.toLowerCase();
    } else if (name === "search_path") {
      searchPath = normalizedSearchPath(setting, variableName);
    }
  }
  return {
    endpoint,
    searchPath: searchPath ?? "public",
    searchPathExplicit: searchPath !== null,
  };
}

function postgresConnectionSemantics(parsed, variableName) {
  const query = lastQueryValues(parsed);
  const user =
    query.get("user") || decodedUrlComponent(parsed.username, variableName);
  const password =
    query.get("password") || decodedUrlComponent(parsed.password, variableName);
  // pg-connection-string percent-decodes a hostname such as
  // `%2Fvar%2Frun%2Fpostgresql` into a Unix-socket path. Apply the same
  // interpretation before enforcing the direct TCP-host contract.
  const effectiveHost =
    query.get("host") || decodedUrlComponent(parsed.hostname, variableName);
  if (effectiveHost.startsWith("/")) {
    throw new Error(
      `${variableName} moet een directe TCP-databasehost gebruiken; Unix-sockets worden niet ondersteund.`,
    );
  }
  const host = normalizedPostgresHost(effectiveHost);
  const port = normalizedPostgresPort(
    query.get("port") || parsed.port,
    variableName,
  );
  const pathname = parsed.pathname.slice(1);
  const pathDatabase = pathname
    ? decodedDatabasePath(pathname, variableName)
    : null;
  if (!pathDatabase) {
    throw new Error(
      `${variableName} mist een expliciete databasenaam in het URL-pad.`,
    );
  }
  const queryDatabase = query.get("database");
  // node-postgres/pg-connection-string takes the database from the URL path
  // after parsing the query string. A conflicting `database` query value is
  // therefore ignored by the runtime driver. Reject that ambiguous spelling
  // instead of letting validation and the actual connection target diverge.
  if (queryDatabase && queryDatabase !== pathDatabase) {
    throw new Error(
      `${variableName} bevat een database-queryparameter die niet overeenkomt met het databasepad in de URL.`,
    );
  }
  const database = pathDatabase;
  const optionSettings = postgresOptionSettings(
    query.get("options"),
    variableName,
  );
  const configuredOptions = query.get("options")?.trim() ?? "";
  query.set(
    "options",
    optionSettings.searchPathExplicit
      ? configuredOptions
      : `${configuredOptions ? `${configuredOptions} ` : ""}-c search_path=public`,
  );
  for (const key of ["user", "password", "host", "port", "database"]) {
    query.delete(key);
  }
  const options = [...query.entries()].sort(
    ([leftKey, leftValue], [rightKey, rightValue]) => {
      const keyOrder = leftKey.localeCompare(rightKey);
      return keyOrder || leftValue.localeCompare(rightValue);
    },
  );
  return {
    user,
    password,
    host,
    port,
    database,
    options,
    searchPath: optionSettings.searchPath,
  };
}

function migrationClientConfig(connectionString) {
  const parsed = parsePostgresUrl(connectionString, "MIGRATION_DATABASE_URL");
  assertNoExternalMigrationTimeouts(parsed, "MIGRATION_DATABASE_URL");
  assertExplicitMigrationCredentials(parsed, "MIGRATION_DATABASE_URL");
  postgresConnectionSemantics(parsed, "MIGRATION_DATABASE_URL");
  const query = lastQueryValues(parsed);
  const configuredOptions = query.get("options")?.trim() ?? "";
  const optionSettings = postgresOptionSettings(
    configuredOptions,
    "MIGRATION_DATABASE_URL",
  );
  const options = optionSettings.searchPathExplicit
    ? configuredOptions
    : `${configuredOptions ? `${configuredOptions} ` : ""}-c search_path=public`;
  const boundedOptions = `${options} -c lock_timeout=${MIGRATION_STATEMENT_LOCK_TIMEOUT_MS}`;
  if (!query.has("options")) {
    return { connectionString, options: boundedOptions };
  }
  parsed.searchParams.delete("options");
  return { connectionString: parsed.toString(), options: boundedOptions };
}

function equivalentPostgresUrls(leftUrl, rightUrl) {
  const parsedLeft = parsePostgresUrl(leftUrl, "MIGRATION_DATABASE_URL");
  const parsedRight = parsePostgresUrl(rightUrl, "DATABASE_URL_UNPOOLED");
  assertNoExternalMigrationTimeouts(parsedLeft, "MIGRATION_DATABASE_URL");
  assertNoExternalMigrationTimeouts(parsedRight, "DATABASE_URL_UNPOOLED");
  const left = postgresConnectionSemantics(
    parsedLeft,
    "MIGRATION_DATABASE_URL",
  );
  const right = postgresConnectionSemantics(
    parsedRight,
    "DATABASE_URL_UNPOOLED",
  );
  return JSON.stringify(left) === JSON.stringify(right);
}

function neonDatabaseIdentity(parsed, variableName) {
  const connection = postgresConnectionSemantics(parsed, variableName);
  const labels = connection.host.split(".");
  if (
    labels.length < 3 ||
    labels.at(-2) !== "neon" ||
    labels.at(-1) !== "tech"
  ) {
    return null;
  }
  labels[0] = labels[0]?.replace(/-pooler$/, "") ?? "";
  const query = lastQueryValues(parsed);
  const optionEndpoint = postgresOptionSettings(
    query.get("options"),
    variableName,
  ).endpoint;
  return {
    endpointHost: labels.join("."),
    computeEndpoint: (optionEndpoint ?? labels[0]).replace(/-pooler$/, ""),
    database: connection.database,
  };
}

function assertMatchingNeonDatabase(
  runtimeUrl,
  migrationUrl,
  migrationVariable,
) {
  if (!runtimeUrl) return;
  const runtimeConnection = postgresConnectionSemantics(
    parsePostgresUrl(runtimeUrl, "DATABASE_URL"),
    "DATABASE_URL",
  );
  const migrationConnection = postgresConnectionSemantics(
    parsePostgresUrl(migrationUrl, migrationVariable),
    migrationVariable,
  );
  if (runtimeConnection.searchPath !== migrationConnection.searchPath) {
    throw new Error(
      `DATABASE_URL en ${migrationVariable} gebruiken niet dezelfde veilige search_path.`,
    );
  }
  const runtimeIdentity = neonDatabaseIdentity(
    parsePostgresUrl(runtimeUrl, "DATABASE_URL"),
    "DATABASE_URL",
  );
  const migrationIdentity = neonDatabaseIdentity(
    parsePostgresUrl(migrationUrl, migrationVariable),
    migrationVariable,
  );
  if (Boolean(runtimeIdentity) !== Boolean(migrationIdentity)) {
    throw new Error(
      `DATABASE_URL en ${migrationVariable} verwijzen niet aantoonbaar naar dezelfde Neon-branch en database.`,
    );
  }
  if (!runtimeIdentity || !migrationIdentity) return;
  if (
    !runtimeIdentity.database ||
    !migrationIdentity.database ||
    runtimeIdentity.endpointHost !== migrationIdentity.endpointHost ||
    runtimeIdentity.computeEndpoint !== migrationIdentity.computeEndpoint ||
    runtimeIdentity.database !== migrationIdentity.database
  ) {
    throw new Error(
      `DATABASE_URL en ${migrationVariable} verwijzen niet aantoonbaar naar dezelfde Neon-branch en database.`,
    );
  }
}

export function isKnownPooledPostgresUrl(rawUrl) {
  const parsed = parsePostgresUrl(rawUrl, "MIGRATION_DATABASE_URL");
  const query = lastQueryValues(parsed);
  const hostname = normalizedPostgresHost(query.get("host") || parsed.hostname);
  const firstLabel = hostname.split(".")[0] ?? "";
  const poolerHost =
    firstLabel === "pooler" ||
    firstLabel.endsWith("-pooler") ||
    hostname.includes(".pooler.") ||
    hostname.includes("-pooler.");
  const poolerParameter =
    ["1", "true"].includes((query.get("pgbouncer") ?? "").toLowerCase()) ||
    query.has("pool_mode") ||
    ["1", "true"].includes(
      (query.get("connection_pooling") ?? "").toLowerCase(),
    );
  const poolerPort =
    normalizedPostgresPort(
      query.get("port") || parsed.port,
      "MIGRATION_DATABASE_URL",
    ) === 6543;
  const optionEndpoint = postgresOptionSettings(
    query.get("options"),
    "MIGRATION_DATABASE_URL",
  ).endpoint;
  const pooledOptionEndpoint = optionEndpoint?.endsWith("-pooler") ?? false;
  return poolerHost || poolerParameter || poolerPort || pooledOptionEndpoint;
}

/**
 * Select the explicit direct connection used only for schema migrations.
 * Runtime queries continue to use DATABASE_URL in src/lib/db.ts.
 */
export function resolveMigrationDatabaseUrl(environment) {
  const runtimeUrl = value(environment, "DATABASE_URL");
  const configuredMigrationUrl = value(environment, "MIGRATION_DATABASE_URL");
  const unpooledUrl = value(environment, "DATABASE_URL_UNPOOLED");
  if (
    configuredMigrationUrl &&
    unpooledUrl &&
    !equivalentPostgresUrls(configuredMigrationUrl, unpooledUrl)
  ) {
    throw new Error(
      "MIGRATION_DATABASE_URL en DATABASE_URL_UNPOOLED verschillen; configureer één eenduidige directe/unpooled migratie-URL.",
    );
  }
  const migrationUrl = configuredMigrationUrl ?? unpooledUrl;
  const migrationVariable = configuredMigrationUrl
    ? "MIGRATION_DATABASE_URL"
    : "DATABASE_URL_UNPOOLED";
  const productionPolicy = productionDatabaseRequired(environment);

  if (!migrationUrl) {
    if (runtimeUrl) {
      throw new Error(
        "MIGRATION_DATABASE_URL of DATABASE_URL_UNPOOLED is verplicht wanneer DATABASE_URL is ingesteld; gebruik een directe/unpooled PostgreSQL-URL voor migraties.",
      );
    }
    if (productionPolicy.required) {
      throw new Error(
        "DATABASE_URL en MIGRATION_DATABASE_URL (of DATABASE_URL_UNPOOLED) zijn verplicht voor een productie-deployment.",
      );
    }
    return null;
  }

  // node-postgres falls back to PG* variables for URL components and options
  // that are absent. Reject ambient state so validation and the connection
  // target cannot silently diverge between machines or deployment runners.
  assertNoAmbientPgConnectionEnvironment(environment);

  const parsedMigrationUrl = parsePostgresUrl(migrationUrl, migrationVariable);
  assertNoExternalMigrationTimeouts(parsedMigrationUrl, migrationVariable);
  assertExplicitMigrationCredentials(parsedMigrationUrl, migrationVariable);
  // Validate the exact database interpretation used by the installed pg
  // driver even when no alias or runtime Neon comparison is needed.
  postgresConnectionSemantics(parsedMigrationUrl, migrationVariable);
  if (isKnownPooledPostgresUrl(migrationUrl)) {
    throw new Error(
      `${migrationVariable} lijkt een pooled/PgBouncer-URL; gebruik de directe/unpooled database-URL.`,
    );
  }
  if (productionPolicy.deployment && !runtimeUrl) {
    throw new Error(
      `DATABASE_URL is naast ${migrationVariable} verplicht voor de production runtime.`,
    );
  }
  assertMatchingNeonDatabase(runtimeUrl, migrationUrl, migrationVariable);
  return migrationUrl;
}

const MIGRATION_PREFLIGHT_QUERY_TIMEOUT_MS = 5_000;

export async function assertMigrationSearchPath(
  client,
  connectionString,
  timeoutMs = MIGRATION_PREFLIGHT_QUERY_TIMEOUT_MS,
) {
  const connection = postgresConnectionSemantics(
    parsePostgresUrl(connectionString, "MIGRATION_DATABASE_URL"),
    "MIGRATION_DATABASE_URL",
  );
  const expectedSchema = connection.searchPath.split(",")[0];
  const queryTimeoutMs = positiveTimeout(
    timeoutMs,
    MIGRATION_PREFLIGHT_QUERY_TIMEOUT_MS,
  );
  const checking = Promise.resolve().then(() =>
    client.query({
      text: "select current_schema() as current_schema",
      query_timeout: queryTimeoutMs,
    }),
  );
  // The JS deadline can win just before node-postgres rejects its own query
  // timeout; always observe that late settlement.
  void checking.catch(() => undefined);
  const result = await within(
    checking,
    queryTimeoutMs,
    "De search_path-preflight van de migratieverbinding duurde te lang.",
  );
  if (result.rows?.[0]?.current_schema !== expectedSchema) {
    throw new Error(
      "De actieve search_path van de migratieverbinding komt niet overeen met de veilige URL-configuratie.",
    );
  }
}

const MIGRATION_CONNECT_TIMEOUT_MS = 10_000;
const MIGRATION_CLOSE_TIMEOUT_MS = 2_000;

function positiveTimeout(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function within(promise, milliseconds, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}

function forceDestroyClient(client) {
  try {
    client?.connection?.stream?.destroy();
  } catch {
    // Best effort: pg releases the session when its underlying socket closes.
  }
}

async function closeDedicatedClient(client, timeoutMs) {
  const closing = Promise.resolve().then(() => client.end());
  // A forced socket close can make the original end promise reject after the
  // caller has already received the bounded close error.
  void closing.catch(() => undefined);
  try {
    await within(
      closing,
      timeoutMs,
      "De PostgreSQL-migratieverbinding kon niet tijdig worden gesloten.",
    );
    return null;
  } catch (error) {
    forceDestroyClient(client);
    return error;
  }
}

/** Keep one physical client alive for lock, scan, apply and unlock. */
export async function withDedicatedMigrationClient(
  pgModule,
  connectionString,
  run,
  timeouts = {},
) {
  if (typeof pgModule?.Client !== "function") {
    throw new TypeError("De PostgreSQL Client-constructor ontbreekt.");
  }
  const connectTimeoutMs = positiveTimeout(
    timeouts.connectTimeoutMs,
    MIGRATION_CONNECT_TIMEOUT_MS,
  );
  const closeTimeoutMs = positiveTimeout(
    timeouts.closeTimeoutMs,
    MIGRATION_CLOSE_TIMEOUT_MS,
  );
  const connectionConfig = migrationClientConfig(connectionString);
  const client = new pgModule.Client({
    ...connectionConfig,
    application_name: "volt-migrator",
    connectionTimeoutMillis: connectTimeoutMs,
  });
  const connecting = Promise.resolve().then(() => client.connect());
  void connecting.catch(() => undefined);
  try {
    await within(
      connecting,
      connectTimeoutMs,
      "De PostgreSQL-migratieverbinding kon niet tijdig worden geopend.",
    );
  } catch (connectError) {
    forceDestroyClient(client);
    await closeDedicatedClient(client, closeTimeoutMs);
    throw connectError;
  }
  let primaryError;
  let result;
  try {
    result = await run(client);
  } catch (error) {
    primaryError = error;
  }
  const closeError = await closeDedicatedClient(client, closeTimeoutMs);
  if (primaryError) throw primaryError;
  if (closeError) throw closeError;
  return result;
}
