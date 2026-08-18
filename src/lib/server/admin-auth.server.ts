import {
  deleteCookie,
  getCookie,
  getRequest,
  setCookie,
  setResponseStatus,
} from "@tanstack/react-start/server";
import {
  signAdminSession,
  timingSafePasswordEqual,
} from "@/lib/server/admin-session.server";
import { getSessionUser } from "@/lib/auth/verify.server";
import {
  applyRateLimitResponse,
  clearRateLimit,
  consumeRateLimit,
  RateLimitError,
} from "@/lib/server/rate-limit.server";
import {
  hasConfiguredAdminAccess,
  resolveAdminAuthorizationConfiguration,
  resolveAdminConfiguration,
} from "@/lib/server/admin-policy.server";
import { getRequestClientIdentifier } from "@/lib/server/request-client.server";

export const ADMIN_COOKIE_NAME = "volt-admin-session";
const ADMIN_SESSION_SECONDS = 4 * 60 * 60;
const LOGIN_WINDOW_MS = 15 * 60 * 1_000;
const MAX_LOGIN_FAILURES = 8;
const MAX_LOGIN_ATTEMPTS = 20;

export class AdminUnauthorizedError extends Error {
  readonly status = 401;

  constructor() {
    super("Beheerderstoegang vereist.");
    this.name = "AdminUnauthorizedError";
  }
}

export class SameOriginRequiredError extends Error {
  readonly status = 403;

  constructor() {
    super("Ongeldige aanvraag.");
    this.name = "SameOriginRequiredError";
  }
}

function productionCookie(): boolean {
  return process.env.NODE_ENV === "production";
}

function requestKey(): string {
  try {
    return getRequestClientIdentifier();
  } catch {
    return "anonymous";
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function assertSameOriginMutation(): void {
  const request = getRequest();
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "same-origin") return;

  const origin = request.headers.get("origin");
  if (origin) {
    const forwardedHost =
      request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    const forwardedProtocol =
      request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.slice(0, -1);
    const expectedOrigin = forwardedHost
      ? `${forwardedProtocol}://${forwardedHost}`
      : new URL(request.url).origin;
    if (origin === expectedOrigin) return;
  }
  throw new SameOriginRequiredError();
}

export async function loginAdminWithPassword(password: string): Promise<void> {
  assertSameOriginMutation();
  const configuration = resolveAdminConfiguration(process.env);
  const passwordLogin = configuration.passwordLogin;
  const key = requestKey();
  const now = Date.now();
  try {
    await consumeRateLimit({
      scope: "admin-login-attempt",
      identifier: key,
      limit: MAX_LOGIN_ATTEMPTS,
      windowMs: LOGIN_WINDOW_MS,
      now: new Date(now),
    });
  } catch (error) {
    applyRateLimitResponse(error);
    throw error;
  }

  if (
    !passwordLogin ||
    !timingSafePasswordEqual(password, passwordLogin.password)
  ) {
    try {
      const failure = await consumeRateLimit({
        scope: "admin-login-failure",
        identifier: key,
        limit: MAX_LOGIN_FAILURES,
        windowMs: LOGIN_WINDOW_MS,
        now: new Date(now),
      });
      await wait(
        Math.min(
          4_000,
          250 * 2 ** Math.min(failure.count - 1, 4),
        ),
      );
    } catch (error) {
      if (!(error instanceof RateLimitError)) throw error;
      await wait(Math.min(error.retryAfterMs, 4_000));
      applyRateLimitResponse(error);
      throw error;
    }
    setResponseStatus(401);
    throw new AdminUnauthorizedError();
  }

  await clearRateLimit("admin-login-failure", key);
  const expiresAt = now + ADMIN_SESSION_SECONDS * 1_000;
  setCookie(
    ADMIN_COOKIE_NAME,
    signAdminSession(passwordLogin.sessionSecret, expiresAt),
    {
      httpOnly: true,
      sameSite: "strict",
      secure: productionCookie(),
      path: "/",
      maxAge: ADMIN_SESSION_SECONDS,
    },
  );
}

export function logoutAdminSession(): void {
  assertSameOriginMutation();
  deleteCookie(ADMIN_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "strict",
    secure: productionCookie(),
    path: "/",
  });
}

export async function isAdminViewer(bearerToken?: string): Promise<boolean> {
  // A broken admin fallback must never take down public order recovery.
  // Admin capability checks still surface the configuration error.
  const configuration = resolveAdminAuthorizationConfiguration(process.env);
  if (!configuration) return false;
  const sessionCookie = getCookie(ADMIN_COOKIE_NAME);
  if (
    hasConfiguredAdminAccess(
      { sessionCookie, userEmail: null },
      configuration,
    )
  ) {
    return true;
  }
  if (!configuration.adminEmails.size) return false;
  const user = await getSessionUser(bearerToken);
  return hasConfiguredAdminAccess(
    { sessionCookie, userEmail: user?.email ?? null },
    configuration,
  );
}

export async function requireAdmin(bearerToken?: string): Promise<void> {
  if (!(await isAdminViewer(bearerToken))) throw new AdminUnauthorizedError();
}

export function getAdminCapabilities(): {
  passwordLoginAvailable: boolean;
  allowlistConfigured: boolean;
} {
  const configuration = resolveAdminConfiguration(process.env);
  return {
    passwordLoginAvailable: Boolean(configuration.passwordLogin),
    allowlistConfigured: configuration.adminEmails.size > 0,
  };
}
