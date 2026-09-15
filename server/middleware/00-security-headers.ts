import { securityHeadersForPath } from "../../src/lib/security-headers";
import {
  configuredHostingerPublicOrigin,
  type ServerEnvironment,
} from "../../src/lib/server/hostinger-proxy.server";

interface SecurityEvent {
  url: URL;
}

export function shouldSendHsts(
  event: SecurityEvent,
  environment: ServerEnvironment = process.env,
): boolean {
  if (environment.NODE_ENV !== "production") return false;
  return (
    event.url.protocol === "https:" ||
    configuredHostingerPublicOrigin(environment) !== null
  );
}

export default async function securityHeadersMiddleware(
  event: SecurityEvent,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  const result = await next();
  if (!(result instanceof Response)) return result;

  const headers = new Headers(result.headers);
  for (const [name, value] of Object.entries(
    securityHeadersForPath(event.url.pathname, {
      hsts: shouldSendHsts(event),
      noIndex:
        process.env.NO_INDEX === "1" || process.env.VITE_NO_INDEX === "1",
    }),
  )) {
    headers.set(name, value);
  }
  if (result.status === 429 && !headers.has("retry-after")) {
    const retryAfter = /Retry-After-(\d+)/.exec(result.statusText)?.[1] ?? "60";
    headers.set("retry-after", retryAfter);
  }
  return new Response(result.body, {
    status: result.status,
    statusText: result.statusText,
    headers,
  });
}
