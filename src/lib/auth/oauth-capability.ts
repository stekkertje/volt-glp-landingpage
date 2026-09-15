type OAuthEnvironment = Record<string, string | undefined>;

function value(
  environment: OAuthEnvironment,
  name: string,
): string | undefined {
  const candidate = environment[name]?.trim();
  return candidate || undefined;
}

export type ServerOAuthCapability = {
  enabled: boolean;
  usePreviewCredentials: boolean;
};

/**
 * Production OAuth is opt-in and requires its own client credentials. Only a
 * non-production preview without an explicit flag may use the baked preview
 * client, whose callback allowlist is intentionally limited to preview hosts.
 */
export function resolveServerOAuthCapability(
  environment: OAuthEnvironment,
): ServerOAuthCapability {
  if (value(environment, "VITE_AUTH_ENABLED") === "false") {
    return { enabled: false, usePreviewCredentials: false };
  }

  const flag = value(environment, "VITE_OAUTH_ENABLED");
  if (flag === "true") {
    if (
      !value(environment, "GROK_AUTH_CLIENT_ID") ||
      !value(environment, "GROK_AUTH_CLIENT_SECRET")
    ) {
      throw new Error(
        "OAuth is ingeschakeld, maar GROK_AUTH_CLIENT_ID of GROK_AUTH_CLIENT_SECRET ontbreekt.",
      );
    }
    return { enabled: true, usePreviewCredentials: false };
  }
  const deployment =
    value(environment, "NODE_ENV") === "production" ||
    Boolean(value(environment, "DATABASE_URL")) ||
    ["REQUIRE_DATABASE", "VERCEL", "NETLIFY", "TRUST_HOSTINGER_PROXY"].some(
      (name) => {
        const candidate = value(environment, name)?.toLowerCase();
        return candidate === "1" || candidate === "true";
      },
    ) ||
    Boolean(value(environment, "BETTER_AUTH_URL")) ||
    Boolean(value(environment, "VITE_PUBLIC_HOSTNAME"));
  if (flag === "false" || deployment) {
    return { enabled: false, usePreviewCredentials: false };
  }
  return { enabled: true, usePreviewCredentials: true };
}

export function resolveClientOAuthCapability(input: {
  authEnabled: boolean;
  explicitFlag: string | boolean | undefined;
  isPreviewHost: boolean;
}): boolean {
  if (!input.authEnabled) return false;
  if (input.explicitFlag === true || input.explicitFlag === "true") return true;
  if (input.explicitFlag === false || input.explicitFlag === "false") {
    return false;
  }
  return input.isPreviewHost;
}
