export type ServerEnvironment = Record<string, string | undefined>;

function enabled(environment: ServerEnvironment, key: string): boolean {
  const value = environment[key]?.trim().toLowerCase();
  return value === "1" || value === "true";
}

export function configuredHostingerPublicOrigin(
  environment: ServerEnvironment = process.env,
): string | null {
  if (environment.NODE_ENV !== "production") return null;
  if (!enabled(environment, "TRUST_HOSTINGER_PROXY")) return null;

  const publicHostname = environment.VITE_PUBLIC_HOSTNAME?.trim().toLowerCase();
  if (!publicHostname) return null;
  let configuredHost: string;
  try {
    const configuredUrl = new URL(`https://${publicHostname}`);
    if (
      configuredUrl.host.toLowerCase() !== publicHostname ||
      configuredUrl.pathname !== "/" ||
      configuredUrl.search ||
      configuredUrl.hash ||
      configuredUrl.username ||
      configuredUrl.password
    ) {
      return null;
    }
    configuredHost = configuredUrl.host.toLowerCase();
  } catch {
    return null;
  }

  return `https://${configuredHost}`;
}
