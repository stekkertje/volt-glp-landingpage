import { securityHeadersForPath } from "../../src/lib/security-headers";

interface SecurityEvent {
  url: URL;
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
      hsts:
        process.env.NODE_ENV === "production" &&
        event.url.protocol === "https:",
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
