import { consumeRateLimit } from "@/lib/server/rate-limit.server";

const HOUR_MS = 60 * 60 * 1_000;
const FIFTEEN_MINUTES_MS = 15 * 60 * 1_000;
const TEN_MINUTES_MS = 10 * 60 * 1_000;

export async function enforceOrderCreationLimit(
  requestIp: string,
  email: string,
): Promise<void> {
  await consumeRateLimit({
    scope: "order-create-ip",
    identifier: requestIp,
    limit: 20,
    windowMs: HOUR_MS,
  });
  await consumeRateLimit({
    scope: "order-create-email",
    identifier: email,
    limit: 8,
    windowMs: HOUR_MS,
  });
}

export async function enforceOrderAccessLimit(
  requestIp: string,
  orderReference: string,
): Promise<void> {
  await consumeRateLimit({
    scope: "order-access-ip",
    identifier: requestIp,
    limit: 40,
    windowMs: FIFTEEN_MINUTES_MS,
  });
  await consumeRateLimit({
    scope: "order-access-reference",
    identifier: `${requestIp}:${orderReference}`,
    limit: 12,
    windowMs: FIFTEEN_MINUTES_MS,
  });
}

export async function enforceContactCreationLimit(
  requestIp: string,
): Promise<void> {
  await consumeRateLimit({
    scope: "contact-create",
    identifier: requestIp,
    limit: 8,
    windowMs: TEN_MINUTES_MS,
  });
}
