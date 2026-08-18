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
 * PGLite is intentionally limited to development, tests, local builds and
 * explicitly marked ephemeral previews. A production runtime or deployment
 * must have persistent Postgres.
 */
export function resolveDatabasePolicy(environment: Environment): DatabasePolicy {
  const databaseUrl = value(environment, "DATABASE_URL");
  if (databaseUrl) return { source: "neon", databaseUrl };

  const explicitPreview = enabled(environment, "PGLITE_PREVIEW");
  const production = value(environment, "NODE_ENV") === "production";
  const deployment =
    enabled(environment, "VERCEL") ||
    enabled(environment, "NETLIFY") ||
    enabled(environment, "REQUIRE_DATABASE");
  const localBuild =
    value(environment, "npm_lifecycle_event") === "build" && !deployment;

  if (!production || explicitPreview || localBuild) {
    return { source: "pglite" };
  }

  throw new Error(
    "DATABASE_URL is verplicht voor productie. " +
      "Gebruik PGLITE_PREVIEW=true alleen voor een expliciet vluchtige preview.",
  );
}
