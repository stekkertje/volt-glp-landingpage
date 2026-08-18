export type DatabasePolicy = {
  source: "neon" | "pglite";
  databaseUrl?: string;
};

export type PostgresConnectionConfig = {
  connectionString: string;
  options: string;
};

export const DEFAULT_POSTGRES_OPTIONS = "-c search_path=public";

type Environment = Record<string, string | undefined>;

function value(environment: Environment, key: string): string | undefined {
  const raw = environment[key]?.trim();
  return raw || undefined;
}

function enabled(environment: Environment, key: string): boolean {
  return value(environment, key)?.toLowerCase() === "true" || value(environment, key) === "1";
}

function hasExplicitSearchPath(options: string): boolean {
  const tokens = options.trim().split(/\s+/).filter(Boolean);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const assignment =
      token === "-c"
        ? (tokens[(index += 1)] ?? "")
        : token.startsWith("-c")
          ? token.slice(2)
          : token.startsWith("--")
            ? token.slice(2)
            : "";
    if (
      assignment.slice(0, assignment.indexOf("=")).toLowerCase() ===
      "search_path"
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Keep runtime and auth queries independent of role-level search_path defaults.
 * URL options still win, but options without an explicit search_path get the
 * documented `public` default appended. Removing the URL parameter is required
 * because node-postgres otherwise overwrites the top-level `options` setting.
 */
export function postgresConnectionConfig(
  connectionString: string,
): PostgresConnectionConfig {
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    // Let node-postgres retain ownership of connection-string validation while
    // still pinning the safe default for legacy non-URL configurations.
    return { connectionString, options: DEFAULT_POSTGRES_OPTIONS };
  }
  const optionValues = parsed.searchParams.getAll("options");
  const configuredOptions = optionValues.at(-1)?.trim() ?? "";
  const options = hasExplicitSearchPath(configuredOptions)
    ? configuredOptions
    : `${configuredOptions ? `${configuredOptions} ` : ""}${DEFAULT_POSTGRES_OPTIONS}`;
  if (!optionValues.length) return { connectionString, options };
  parsed.searchParams.delete("options");
  return { connectionString: parsed.toString(), options };
}

/**
 * PGLite is intentionally limited to development, tests and local builds.
 * Every production runtime and every deployment must have persistent Postgres.
 */
export function resolveDatabasePolicy(environment: Environment): DatabasePolicy {
  const databaseUrl = value(environment, "DATABASE_URL");
  if (databaseUrl) return { source: "neon", databaseUrl };

  const production = value(environment, "NODE_ENV") === "production";
  const deployment =
    enabled(environment, "VERCEL") ||
    enabled(environment, "NETLIFY") ||
    enabled(environment, "REQUIRE_DATABASE");
  const localBuild =
    value(environment, "npm_lifecycle_event") === "build" && !deployment;

  if (deployment) {
    throw new Error("DATABASE_URL is verplicht voor iedere deployment.");
  }
  if (!production || localBuild) {
    return { source: "pglite" };
  }

  throw new Error("DATABASE_URL is verplicht voor productie.");
}
