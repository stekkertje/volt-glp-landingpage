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

function invalidEncodedPassword(): AdminConfigurationError {
  return new AdminConfigurationError(
    "ADMIN_PASSWORD_BASE64 moet geldige base64 of base64url met UTF-8 bevatten.",
  );
}

function decodeAdminPassword(encoded: string): string {
  const standard = /^[A-Za-z0-9+/]+={0,2}$/.test(encoded);
  const urlSafe = /^[A-Za-z0-9_-]+={0,2}$/.test(encoded);
  if (!standard && !urlSafe) throw invalidEncodedPassword();

  const unpadded = encoded.replace(/=+$/, "");
  const paddingLength = encoded.length - unpadded.length;
  if (
    unpadded.length % 4 === 1 ||
    (paddingLength > 0 && encoded.length % 4 !== 0)
  ) {
    throw invalidEncodedPassword();
  }

  const normalized = unpadded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  const bytes = Buffer.from(padded, "base64");
  if (bytes.toString("base64").replace(/=+$/, "") !== normalized) {
    throw invalidEncodedPassword();
  }

  let password: string;
  try {
    password = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw invalidEncodedPassword();
  }
  const hasControlCharacter = /\p{Cc}/u.test(password);
  if (!password || hasControlCharacter) {
    throw invalidEncodedPassword();
  }
  return password;
}

export function resolveAdminConfiguration(
  environment: Environment,
): AdminConfiguration {
  const production = value(environment, "NODE_ENV") === "production";
  const rawPassword = value(environment, "ADMIN_PASSWORD");
  const encodedPassword = value(environment, "ADMIN_PASSWORD_BASE64");
  if (rawPassword && encodedPassword) {
    throw new AdminConfigurationError(
      "Stel ADMIN_PASSWORD of ADMIN_PASSWORD_BASE64 in, nooit beide.",
    );
  }
  const password = encodedPassword
    ? decodeAdminPassword(encodedPassword)
    : rawPassword;
  const sessionSecret = value(environment, "ADMIN_SESSION_SECRET");
  if (Boolean(password) !== Boolean(sessionSecret)) {
    throw new AdminConfigurationError(
      password
        ? "ADMIN_SESSION_SECRET ontbreekt voor password-admin."
        : "ADMIN_PASSWORD of ADMIN_PASSWORD_BASE64 ontbreekt voor password-admin.",
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
  for (const rawEmail of (value(environment, "ADMIN_EMAILS") ?? "").split(
    ",",
  )) {
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
