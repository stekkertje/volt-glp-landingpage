export type DatabasePolicy = {
  source: "neon" | "pglite";
  databaseUrl?: string;
};

type Environment = Record<string, string | undefined>;

function value(environment: Environment, key: string): string | undefined {
  const raw = environment[key]?.trim();
  return raw || undefined;
}

function enabled(environment: Environment, key: string): boolean {
  return value(environment, key)?.toLowerCase() === "true" || value(environment, key) === "1";
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
