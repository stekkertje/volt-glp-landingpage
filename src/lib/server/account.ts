import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import {
  createPublicServerErrorMiddleware,
  type PublicServerErrorPolicy,
} from "@/lib/server-error";

const ACCOUNT_SERVER_ERROR_POLICY = {
  fallbackMessage: "De accountactie kon niet worden verwerkt.",
  allowedNames: new Set([
    "AccountEmailVerificationRequiredError",
    "GuestOrderClaimError",
  ]),
  statusByName: {
    AccountEmailVerificationRequiredError: 403,
    GuestOrderClaimError: 400,
  },
} satisfies PublicServerErrorPolicy;

const accountServerErrorMiddleware = createPublicServerErrorMiddleware(
  ACCOUNT_SERVER_ERROR_POLICY,
);

const emptyInputSchema = z.object({}).strict();
const claimTokenSchema = z
  .object({
    token: z
      .string()
      .trim()
      .min(40)
      .max(100)
      .regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict();

async function publicOrigin(): Promise<string> {
  const { getRequest } = await import("@tanstack/react-start/server");
  const { configuredHostingerPublicOrigin } =
    await import("@/lib/server/hostinger-proxy.server");
  const configured = configuredHostingerPublicOrigin(process.env);
  if (configured) return configured;
  const request = getRequest();
  if (!request) throw new Error("Aanvraagcontext ontbreekt.");
  return new URL(request.url).origin;
}

export const listAccountOrders = createServerFn({ method: "GET" })
  .middleware([accountServerErrorMiddleware, authMiddleware])
  .handler(async ({ context }) => {
    const { listAccountOrderRecords } = await import("./account.server");
    return listAccountOrderRecords(context.userId);
  });

export const requestGuestOrderClaim = createServerFn({ method: "POST" })
  .middleware([accountServerErrorMiddleware, authMiddleware])
  .validator(emptyInputSchema)
  .handler(async ({ context }) => {
    const { assertSameOriginMutation } = await import("./admin-auth.server");
    assertSameOriginMutation();
    const { consumeRateLimit, applyRateLimitResponse } =
      await import("./rate-limit.server");
    const { getRequestClientIdentifier } =
      await import("./request-client.server");
    try {
      await consumeRateLimit({
        scope: "guest-order-claim-user",
        identifier: context.userId,
        limit: 5,
        windowMs: 60 * 60 * 1_000,
      });
      await consumeRateLimit({
        scope: "guest-order-claim-ip",
        identifier: getRequestClientIdentifier(),
        limit: 20,
        windowMs: 60 * 60 * 1_000,
      });
    } catch (error) {
      applyRateLimitResponse(error);
      throw error;
    }
    const { requestGuestOrderClaimRecord } = await import("./account.server");
    await requestGuestOrderClaimRecord({
      userId: context.userId,
      publicOrigin: await publicOrigin(),
    });
    return {
      message:
        "Controleer je e-mail om eerdere gastbestellingen veilig te koppelen.",
    };
  });

export const confirmGuestOrderClaim = createServerFn({ method: "POST" })
  .middleware([accountServerErrorMiddleware, authMiddleware])
  .validator(claimTokenSchema)
  .handler(async ({ data, context }) => {
    const { assertSameOriginMutation } = await import("./admin-auth.server");
    assertSameOriginMutation();
    const { consumeRateLimit, applyRateLimitResponse } =
      await import("./rate-limit.server");
    const { getRequestClientIdentifier } =
      await import("./request-client.server");
    try {
      await consumeRateLimit({
        scope: "guest-order-claim-confirm",
        identifier: `${context.userId}:${getRequestClientIdentifier()}`,
        limit: 20,
        windowMs: 15 * 60 * 1_000,
      });
    } catch (error) {
      applyRateLimitResponse(error);
      throw error;
    }
    const { confirmGuestOrderClaimRecord } = await import("./account.server");
    return confirmGuestOrderClaimRecord({
      userId: context.userId,
      token: data.token,
    });
  });
