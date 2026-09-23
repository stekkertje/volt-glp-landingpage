import {
  isSensitiveDocumentPath,
  securityHeadersForPath,
} from "../../src/lib/security-headers";
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

function extractHostname(event: SecurityEvent): string {
  const anyEvent = event as unknown as {
    node?: { req?: { headers?: Record<string, string | string[] | undefined> } };
    headers?: Headers;
  };
  const nodeHost = anyEvent.node?.req?.headers?.["host"];
  const headerHost =
    typeof nodeHost === "string"
      ? nodeHost
      : typeof anyEvent.headers?.get === "function"
        ? anyEvent.headers.get("host")
        : null;
  const host = headerHost || event.url?.host || "";
  return host.toLowerCase().split(":")[0];
}

export default async function securityHeadersMiddleware(
  event: SecurityEvent,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  const hostname = extractHostname(event);
  if (hostname.startsWith("www.")) {
    const cleanHost = hostname.replace(/^www\./i, "");
    const pathname = event.url?.pathname || "/";
    const search = event.url?.search || "";
    return new Response(null, {
      status: 301,
      headers: {
        Location: `https://${cleanHost}${pathname}${search}`,
      },
    });
  }

  const result = await next();
  if (!(result instanceof Response)) return result;

  const headers = new Headers(result.headers);
  for (const [name, value] of Object.entries(
    securityHeadersForPath(event.url.pathname, {
      hsts: shouldSendHsts(event),
      noIndex:
        isSensitiveDocumentPath(event.url.pathname) ||
        process.env.NO_INDEX === "1" ||
        process.env.VITE_NO_INDEX === "1" ||
        process.env.FORCE_NO_INDEX === "1",
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
