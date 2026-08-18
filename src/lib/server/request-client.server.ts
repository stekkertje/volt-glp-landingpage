import {
  getRequest,
  getRequestIP,
} from "@tanstack/react-start/server";

type Environment = Record<string, string | undefined>;

function enabled(environment: Environment, key: string): boolean {
  const value = environment[key]?.trim().toLowerCase();
  return value === "1" || value === "true";
}

function trustedHeaderIp(value: string | null): string | null {
  const candidate = value?.trim() ?? "";
  if (
    !candidate ||
    candidate.length > 128 ||
    !/^[0-9a-f:.]+$/i.test(candidate)
  ) {
    return null;
  }
  return candidate;
}

export function resolveClientIdentifier({
  headers,
  directIp,
  environment,
}: {
  headers: Headers;
  directIp?: string | null;
  environment: Environment;
}): string {
  if (enabled(environment, "VERCEL")) {
    return trustedHeaderIp(headers.get("x-real-ip")) ?? "anonymous";
  }
  if (enabled(environment, "NETLIFY")) {
    return (
      trustedHeaderIp(headers.get("x-nf-client-connection-ip")) ?? "anonymous"
    );
  }
  return directIp?.trim() || "anonymous";
}

export function getRequestClientIdentifier(): string {
  const request = getRequest();
  let directIp: string | null = null;
  try {
    directIp = getRequestIP() || null;
  } catch {
    directIp = null;
  }
  return resolveClientIdentifier({
    headers: request.headers,
    directIp,
    environment: process.env,
  });
}
