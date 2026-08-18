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

export const ADMIN_COOKIE_NAME = "__Host-volt-admin-session";
const ADMIN_SESSION_SECONDS = 4 * 60 * 60;
const LOGIN_WINDOW_MS = 15 * 60 * 1_000;
const MAX_LOGIN_FAILURES = 8;
const MAX_LOGIN_ATTEMPTS = 20;
const MIN_LOGIN_RESPONSE_MS = 250;
const MAX_LOGIN_BACKOFF_MS = 4_000;

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
  if (!isSameOriginMutationRequest(request)) {
    setResponseStatus(403);
    throw new SameOriginRequiredError();
  }
}

function originOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function isSameOriginMutationRequest(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return false;

  const expectedOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (origin && originOf(origin) !== expectedOrigin) return false;

  const referer = request.headers.get("referer");
  if (referer && originOf(referer) !== expectedOrigin) return false;

  return fetchSite === "same-origin" || Boolean(origin) || Boolean(referer);
}

export function adminLoginBackoffMs(failureCount: number): number {
  const normalizedCount = Math.max(1, Math.trunc(failureCount));
  return Math.min(
    MAX_LOGIN_BACKOFF_MS,
    MIN_LOGIN_RESPONSE_MS * 2 ** Math.min(normalizedCount - 1, 4),
  );
}

async function waitForMinimumDuration(
  startedAt: number,
  minimumDurationMs: number,
): Promise<void> {
  await wait(Math.max(0, minimumDurationMs - (Date.now() - startedAt)));
}

export async function loginAdminWithPassword(password: string): Promise<void> {
  const startedAt = Date.now();
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
    await waitForMinimumDuration(startedAt, MIN_LOGIN_RESPONSE_MS);
    applyRateLimitResponse(error);
    throw error;
  }

  const matchedPasswordLogin =
    passwordLogin && timingSafePasswordEqual(password, passwordLogin.password)
      ? passwordLogin
      : null;
  if (!matchedPasswordLogin) {
    try {
      const failure = await consumeRateLimit({
        scope: "admin-login-failure",
        identifier: key,
        limit: MAX_LOGIN_FAILURES,
        windowMs: LOGIN_WINDOW_MS,
        now: new Date(now),
      });
      await waitForMinimumDuration(
        startedAt,
        adminLoginBackoffMs(failure.count),
      );
    } catch (error) {
      if (!(error instanceof RateLimitError)) throw error;
      await waitForMinimumDuration(
        startedAt,
        Math.max(
          MIN_LOGIN_RESPONSE_MS,
          Math.min(error.retryAfterMs, MAX_LOGIN_BACKOFF_MS),
        ),
      );
      applyRateLimitResponse(error);
      throw error;
    }
    setResponseStatus(401);
    throw new AdminUnauthorizedError();
  }

  await clearRateLimit("admin-login-failure", key);
  await waitForMinimumDuration(startedAt, MIN_LOGIN_RESPONSE_MS);
  const expiresAt = now + ADMIN_SESSION_SECONDS * 1_000;
  setCookie(
    ADMIN_COOKIE_NAME,
    signAdminSession(matchedPasswordLogin.sessionSecret, expiresAt),
    {
      httpOnly: true,
      sameSite: "strict",
      secure: true,
      path: "/",
      maxAge: ADMIN_SESSION_SECONDS,
    },
  );
}

export async function logoutAdminSession(bearerToken?: string): Promise<void> {
  assertSameOriginMutation();
  deleteCookie(ADMIN_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "strict",
    secure: true,
    path: "/",
  });

  const request = getRequest();
  const { auth, authConfigured } = await import("@/lib/auth/server");
  if (!authConfigured || !request) return;
  const headers = new Headers(request.headers);
  if (bearerToken) {
    headers.set("authorization", `Bearer ${bearerToken}`);
  }
  await auth.api.signOut({ headers });
}

export async function isAdminViewer(bearerToken?: string): Promise<boolean> {
  // A broken admin fallback must never take down public order recovery.
  // Capability probes use the same fail-closed configuration state.
  const configuration = resolveAdminAuthorizationConfiguration(process.env);
  if (!configuration) return false;
  const sessionCookie = getCookie(ADMIN_COOKIE_NAME);
  if (
    hasConfiguredAdminAccess({ sessionCookie, userEmail: null }, configuration)
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

export function getAdminCapabilities(
  environment: Record<string, string | undefined> = process.env,
): {
  passwordLoginAvailable: boolean;
  allowlistConfigured: boolean;
} {
  const configuration = resolveAdminAuthorizationConfiguration(environment);
  if (!configuration) {
    return {
      passwordLoginAvailable: false,
      allowlistConfigured: false,
    };
  }
  return {
    passwordLoginAvailable: Boolean(configuration.passwordLogin),
    allowlistConfigured: configuration.adminEmails.size > 0,
  };
}
