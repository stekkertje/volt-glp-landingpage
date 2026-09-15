export type IntegrationProvider = "apicheck" | "google" | "myparcel";

export type IntegrationErrorCode =
  | "not_configured"
  | "unauthorized"
  | "rate_limited"
  | "timeout"
  | "network_error"
  | "invalid_response"
  | "remote_rejected"
  | "remote_unavailable"
  | "not_found";

/**
 * Safe, provider-neutral error. It deliberately never contains response bodies,
 * request URLs with query parameters, API keys, or submitted customer data.
 */
export class IntegrationError extends Error {
  readonly provider: IntegrationProvider;
  readonly code: IntegrationErrorCode;
  readonly retryable: boolean;
  readonly httpStatus: number | null;

  constructor(input: {
    provider: IntegrationProvider;
    code: IntegrationErrorCode;
    retryable: boolean;
    httpStatus?: number | null;
  }) {
    super(`${input.provider}:${input.code}`);
    this.name = "IntegrationError";
    this.provider = input.provider;
    this.code = input.code;
    this.retryable = input.retryable;
    this.httpStatus = input.httpStatus ?? null;
  }
}

export type HttpTransport = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export function mapHttpStatus(
  provider: IntegrationProvider,
  status: number,
): IntegrationError {
  if (status === 401 || status === 403) {
    return new IntegrationError({
      provider,
      code: "unauthorized",
      retryable: false,
      httpStatus: status,
    });
  }
  if (status === 404) {
    return new IntegrationError({
      provider,
      code: "not_found",
      retryable: false,
      httpStatus: status,
    });
  }
  if (status === 408 || status === 429) {
    return new IntegrationError({
      provider,
      code: status === 429 ? "rate_limited" : "timeout",
      retryable: true,
      httpStatus: status,
    });
  }
  return new IntegrationError({
    provider,
    code: status >= 500 ? "remote_unavailable" : "remote_rejected",
    retryable: status >= 500,
    httpStatus: status,
  });
}

export async function fetchWithTimeout(
  transport: HttpTransport,
  input: string | URL | Request,
  init: RequestInit,
  timeoutMs: number,
  provider: IntegrationProvider,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await transport(input, { ...init, signal: controller.signal });
  } catch {
    const timedOut = controller.signal.aborted;
    throw new IntegrationError({
      provider,
      code: timedOut ? "timeout" : "network_error",
      retryable: true,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function readJsonObject(
  response: Response,
  provider: IntegrationProvider,
): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("not-an-object");
    }
    return value as Record<string, unknown>;
  } catch {
    throw new IntegrationError({
      provider,
      code: "invalid_response",
      retryable: false,
      httpStatus: response.status,
    });
  }
}
