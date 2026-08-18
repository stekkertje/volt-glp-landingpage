import {
  deleteCookie,
  getCookie,
  getRequest,
  getRequestIP,
  setCookie,
} from "@tanstack/react-start/server";
import {
  signAdminSession,
  timingSafePasswordEqual,
  verifyAdminSession,
} from "@/lib/server/admin-session.server";
import { getSessionUser } from "@/lib/auth/verify.server";

export const ADMIN_COOKIE_NAME = "volt-admin-session";
const ADMIN_SESSION_SECONDS = 4 * 60 * 60;
const LOGIN_WINDOW_MS = 15 * 60 * 1_000;
const MAX_LOGIN_FAILURES = 8;

type LoginAttempt = {
  failures: number;
  blockedUntil: number;
  lastSeen: number;
};

const globalAdminRef = globalThis as typeof globalThis & {
  __voltAdminLoginAttempts__?: Map<string, LoginAttempt>;
};

const loginAttempts =
  globalAdminRef.__voltAdminLoginAttempts__ ??
  (globalAdminRef.__voltAdminLoginAttempts__ = new Map());

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

function env(name: string): string | null {
  const value = process.env[name]?.trim();
  return value || null;
}

function adminConfig(): { password: string; sessionSecret: string } | null {
  const password = env("ADMIN_PASSWORD");
  const sessionSecret = env("ADMIN_SESSION_SECRET");
  return password && sessionSecret ? { password, sessionSecret } : null;
}

function configuredAdminEmails(): Set<string> {
  return new Set(
    (env("ADMIN_EMAILS") ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

function productionCookie(): boolean {
  return process.env.NODE_ENV === "production";
}

function requestKey(): string {
  try {
    return getRequestIP({ xForwardedFor: true }) || "unknown";
  } catch {
    return "unknown";
  }
}

function clearExpiredAttempts(now: number): void {
  for (const [key, attempt] of loginAttempts) {
    if (now - attempt.lastSeen > LOGIN_WINDOW_MS) loginAttempts.delete(key);
  }
}

function loginDelay(attempt: LoginAttempt | undefined, now: number): number {
  if (!attempt) return 0;
  if (now - attempt.lastSeen > LOGIN_WINDOW_MS) return 0;
  return Math.max(0, attempt.blockedUntil - now);
}

function recordFailedLogin(key: string, now: number): number {
  const previous = loginAttempts.get(key);
  const failures =
    previous && now - previous.lastSeen <= LOGIN_WINDOW_MS ? previous.failures + 1 : 1;
  const backoff = Math.min(4_000, 250 * 2 ** Math.min(failures - 1, 4));
  const blockedUntil =
    failures >= MAX_LOGIN_FAILURES ? now + LOGIN_WINDOW_MS : now + backoff;
  loginAttempts.set(key, { failures, blockedUntil, lastSeen: now });
  return backoff;
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
  const config = adminConfig();
  const key = requestKey();
  const now = Date.now();
  clearExpiredAttempts(now);

  const delay = loginDelay(loginAttempts.get(key), now);
  if (delay > 0) {
    await wait(Math.min(delay, 4_000));
    throw new AdminUnauthorizedError();
  }

  if (!config || !timingSafePasswordEqual(password, config.password)) {
    await wait(recordFailedLogin(key, now));
    throw new AdminUnauthorizedError();
  }

  loginAttempts.delete(key);
  const expiresAt = now + ADMIN_SESSION_SECONDS * 1_000;
  setCookie(ADMIN_COOKIE_NAME, signAdminSession(config.sessionSecret, expiresAt), {
    httpOnly: true,
    sameSite: "strict",
    secure: productionCookie(),
    path: "/",
    maxAge: ADMIN_SESSION_SECONDS,
  });
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
  const config = adminConfig();
  if (!config) return false;

  if (verifyAdminSession(getCookie(ADMIN_COOKIE_NAME), config.sessionSecret)) {
    return true;
  }

  const emails = configuredAdminEmails();
  if (!emails.size) return false;
  const user = await getSessionUser(bearerToken);
  return Boolean(user?.email && emails.has(user.email.toLowerCase()));
}

export async function requireAdmin(bearerToken?: string): Promise<void> {
  if (!(await isAdminViewer(bearerToken))) throw new AdminUnauthorizedError();
}
