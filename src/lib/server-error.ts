import { createMiddleware } from "@tanstack/react-start";

type ErrorLike = {
  message?: unknown;
  name?: unknown;
  status?: unknown;
};

export const ORDER_CONFLICT_ERROR_MESSAGE = "Deze bestelling is al geplaatst.";

export type PublicServerErrorPolicy = {
  fallbackMessage: string;
  allowedNames?: ReadonlySet<string>;
  messageByName?: Readonly<Record<string, string>>;
  statusByName?: Readonly<Record<string, number>>;
};

export type PublicServerErrorResolution = {
  internal: boolean;
  message: string;
  status: number;
};

function asErrorLike(error: unknown): ErrorLike {
  return error && typeof error === "object" ? (error as ErrorLike) : {};
}

function isSerializedValidationIssueList(message: string): boolean {
  if (!message.startsWith("[")) return false;
  try {
    const issues = JSON.parse(message) as unknown;
    return (
      Array.isArray(issues) &&
      issues.length > 0 &&
      issues.every(
        (issue) =>
          issue !== null &&
          typeof issue === "object" &&
          "message" in issue &&
          typeof issue.message === "string" &&
          "path" in issue &&
          Array.isArray(issue.path),
      )
    );
  } catch {
    return false;
  }
}

export function isUnauthorizedServerError(error: unknown): boolean {
  const candidate = asErrorLike(error);
  return (
    candidate.status === 401 ||
    candidate.name === "AdminUnauthorizedError" ||
    candidate.message === "Beheerderstoegang vereist."
  );
}

export function isConflictServerError(error: unknown): boolean {
  const candidate = asErrorLike(error);
  return (
    candidate.status === 409 ||
    candidate.name === "IdempotencyConflictError" ||
    candidate.message === ORDER_CONFLICT_ERROR_MESSAGE
  );
}

export function rateLimitFeedback(error: unknown): string | null {
  const candidate = asErrorLike(error);
  const message =
    typeof candidate.message === "string" ? candidate.message : "";
  if (
    candidate.status === 429 ||
    candidate.name === "RateLimitError" ||
    message.startsWith("Te veel pogingen.")
  ) {
    return message || "Te veel pogingen. Probeer het later opnieuw.";
  }
  return null;
}

export function resolvePublicServerError(
  error: unknown,
  policy: PublicServerErrorPolicy,
): PublicServerErrorResolution {
  const candidate = asErrorLike(error);
  const name = typeof candidate.name === "string" ? candidate.name : "";
  const message =
    typeof candidate.message === "string" ? candidate.message : "";
  const status =
    typeof candidate.status === "number" &&
    Number.isInteger(candidate.status) &&
    candidate.status >= 400 &&
    candidate.status <= 599
      ? candidate.status
      : null;
  const validationError =
    name === "ZodError" || isSerializedValidationIssueList(message);
  const commonMessage =
    name === "CrossSiteRequestError" || name === "SameOriginRequiredError"
      ? "Ongeldige aanvraag."
      : name === "UnauthorizedError"
        ? "Unauthorized"
        : name === "AdminUnauthorizedError"
          ? "Beheerderstoegang vereist."
          : name === "RateLimitError" && message.startsWith("Te veel pogingen.")
            ? message
            : validationError
              ? "Ongeldige invoer."
              : null;
  const policyMessage = policy.messageByName?.[name];
  const allowedMessage = policy.allowedNames?.has(name) ? message : null;
  const publicMessage = commonMessage ?? policyMessage ?? allowedMessage;
  if (!publicMessage) {
    return { internal: true, message: policy.fallbackMessage, status: 500 };
  }
  return {
    internal: false,
    message: publicMessage,
    status:
      status ?? policy.statusByName?.[name] ?? (validationError ? 400 : 500),
  };
}

/**
 * Error instances lose their custom fields at the TanStack server-function
 * boundary. This outer middleware turns known failures into stable, safe
 * messages before that serialization and prevents unexpected internal error
 * details from reaching the browser.
 */
export function createPublicServerErrorMiddleware(
  policy: PublicServerErrorPolicy,
) {
  return createMiddleware({ type: "function" }).server(async ({ next }) => {
    try {
      return await next();
    } catch (error) {
      const resolution = resolvePublicServerError(error, policy);
      const { setResponseHeader, setResponseStatus } =
        await import("@tanstack/react-start/server");
      setResponseStatus(resolution.status);
      setResponseHeader("cache-control", "no-store");

      if (resolution.internal) {
        console.error(
          "[server-function] Internal error hidden from client",
          error,
        );
      }
      throw new Error(resolution.message);
    }
  });
}
