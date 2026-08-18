import { verifyAdminSession } from "@/lib/server/admin-session.server";

type Environment = Record<string, string | undefined>;

export type AdminConfiguration = {
  adminEmails: ReadonlySet<string>;
  passwordLogin: {
    password: string;
    sessionSecret: string;
  } | null;
};

export class AdminConfigurationError extends Error {
  readonly status = 500;

  constructor(message: string) {
    super(message);
    this.name = "AdminConfigurationError";
  }
}

function value(environment: Environment, key: string): string | null {
  return environment[key]?.trim() || null;
}

export function resolveAdminConfiguration(
  environment: Environment,
): AdminConfiguration {
  const production = value(environment, "NODE_ENV") === "production";
  const password = value(environment, "ADMIN_PASSWORD");
  const sessionSecret = value(environment, "ADMIN_SESSION_SECRET");
  if (Boolean(password) !== Boolean(sessionSecret)) {
    throw new AdminConfigurationError(
      password
        ? "ADMIN_SESSION_SECRET ontbreekt voor password-admin."
        : "ADMIN_PASSWORD ontbreekt voor password-admin.",
    );
  }
  if (production && password && password.length < 16) {
    throw new AdminConfigurationError(
      "ADMIN_PASSWORD moet in productie minimaal 16 tekens bevatten.",
    );
  }
  if (production && sessionSecret && sessionSecret.length < 32) {
    throw new AdminConfigurationError(
      "ADMIN_SESSION_SECRET moet in productie minimaal 32 tekens bevatten.",
    );
  }
  if (password && sessionSecret && password === sessionSecret) {
    throw new AdminConfigurationError(
      "ADMIN_PASSWORD en ADMIN_SESSION_SECRET moeten verschillend zijn.",
    );
  }

  const adminEmails = new Set<string>();
  for (const rawEmail of (value(environment, "ADMIN_EMAILS") ?? "").split(",")) {
    const email = rawEmail.trim().toLowerCase();
    if (!email) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new AdminConfigurationError(
        "ADMIN_EMAILS bevat een ongeldig e-mailadres.",
      );
    }
    adminEmails.add(email);
  }

  return {
    adminEmails,
    passwordLogin:
      password && sessionSecret ? { password, sessionSecret } : null,
  };
}

export function resolveAdminAuthorizationConfiguration(
  environment: Environment,
): AdminConfiguration | null {
  try {
    return resolveAdminConfiguration(environment);
  } catch (error) {
    if (error instanceof AdminConfigurationError) return null;
    throw error;
  }
}

export function hasConfiguredAdminAccess(
  viewer: {
    sessionCookie?: string | null;
    userEmail?: string | null;
    now?: number;
  },
  configuration: AdminConfiguration,
): boolean {
  if (
    viewer.userEmail &&
    configuration.adminEmails.has(viewer.userEmail.toLowerCase())
  ) {
    return true;
  }
  return Boolean(
    configuration.passwordLogin &&
      verifyAdminSession(
        viewer.sessionCookie,
        configuration.passwordLogin.sessionSecret,
        viewer.now,
      ),
  );
}
