import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import { sameSiteMiddleware } from "@/lib/server/same-site-middleware";
import { createPublicServerErrorMiddleware } from "@/lib/server-error";

const addressValidationErrorMiddleware = createPublicServerErrorMiddleware({
  fallbackMessage: "Het bezorgadres kon niet worden gecontroleerd.",
  allowedNames: new Set(),
});

const text = (max: number) =>
  z.string().trim().min(1, "Dit adresveld is verplicht.").max(max);

const checkoutAddressSchema = z
  .object({
    street: text(120),
    houseNumber: text(30),
    postcode: text(16),
    city: text(120),
    country: z.enum(["NL", "BE"]),
  })
  .strict();

export const validateCheckoutAddress = createServerFn({ method: "POST" })
  .middleware([addressValidationErrorMiddleware, sameSiteMiddleware])
  .validator(checkoutAddressSchema)
  .handler(async ({ data }) => {
    const { consumeRateLimit, applyRateLimitResponse } =
      await import("./rate-limit.server");
    const { getRequestClientIdentifier } =
      await import("./request-client.server");
    try {
      await consumeRateLimit({
        scope: "checkout-address-validation",
        identifier: getRequestClientIdentifier(),
        limit: 40,
        windowMs: 15 * 60 * 1_000,
      });
    } catch (error) {
      applyRateLimitResponse(error);
      throw error;
    }

    const { createAddressValidationServiceFromEnv } =
      await import("./integrations/address-validation.server");
    const result = await createAddressValidationServiceFromEnv().validate(data);
    if (
      (result.status !== "valid" && result.status !== "needs_confirmation") ||
      !result.provider ||
      !result.normalizedAddress
    ) {
      return {
        status: result.status,
        provider: result.provider,
        normalizedAddress: result.normalizedAddress,
        changedFields: result.changedFields,
        retryable: result.retryable,
        validationToken: null,
      };
    }

    const { issueAddressValidationToken } =
      await import("./address-validation-token.server");
    return {
      status: result.status,
      provider: result.provider,
      normalizedAddress: result.normalizedAddress,
      changedFields: result.changedFields,
      retryable: false,
      validationToken: issueAddressValidationToken({
        address: result.normalizedAddress,
        provider: result.provider,
      }),
    };
  });
