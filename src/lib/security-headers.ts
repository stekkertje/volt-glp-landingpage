const FRAME_ANCESTORS = [
  "'self'",
  "https://grok.com",
  "https://*.grok.com",
  "https://x.ai",
  "https://*.x.ai",
  "https://*.grok.me",
].join(" ");

export function isSensitiveDocumentPath(pathname: string): boolean {
  return (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/account" ||
    pathname.startsWith("/account/") ||
    pathname === "/checkout" ||
    pathname.startsWith("/bestelling/")
  );
}

export function securityHeadersForPath(
  pathname: string,
  options: { development?: boolean; hsts?: boolean } = {},
): Record<string, string> {
  const scriptSources = ["'self'", "'unsafe-inline'"];
  if (options.development) scriptSources.push("'unsafe-eval'");
  const headers: Record<string, string> = {
    "content-security-policy": [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      `script-src ${scriptSources.join(" ")}`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' https: ws: wss:",
      "manifest-src 'self'",
      "worker-src 'self' blob:",
      "form-action 'self'",
      `frame-ancestors ${FRAME_ANCESTORS}`,
    ].join("; "),
    "permissions-policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-content-type-options": "nosniff",
  };
  if (options.hsts) {
    headers["strict-transport-security"] = "max-age=31536000";
  }
  if (isSensitiveDocumentPath(pathname)) {
    headers["cache-control"] = "no-store";
    headers.pragma = "no-cache";
  }
  return headers;
}
