type ErrorLike = {
  message?: unknown;
  name?: unknown;
  status?: unknown;
};

function asErrorLike(error: unknown): ErrorLike {
  return error && typeof error === "object" ? (error as ErrorLike) : {};
}

export function isUnauthorizedServerError(error: unknown): boolean {
  const candidate = asErrorLike(error);
  return (
    candidate.status === 401 ||
    candidate.name === "AdminUnauthorizedError" ||
    candidate.message === "Beheerderstoegang vereist."
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
