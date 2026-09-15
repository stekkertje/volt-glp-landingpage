import { createServerFn } from "@tanstack/react-start";
import { adminMiddleware } from "@/lib/server/admin-middleware";
import {
  contactHandledSchema,
  contactListSchema,
  contactMessageSchema,
} from "@/lib/server/contact-schema";
import { sameSiteMiddleware } from "@/lib/server/same-site-middleware";
import {
  createPublicServerErrorMiddleware,
  type PublicServerErrorPolicy,
} from "@/lib/server-error";

const CONTACT_SERVER_ERROR_POLICY = {
  fallbackMessage: "Het contactverzoek kon niet worden verwerkt.",
  allowedNames: new Set(["ContactIdempotencyConflictError"]),
  statusByName: { ContactIdempotencyConflictError: 409 },
} satisfies PublicServerErrorPolicy;

const contactServerErrorMiddleware = createPublicServerErrorMiddleware(
  CONTACT_SERVER_ERROR_POLICY,
);

export const createContactMessage = createServerFn({ method: "POST" })
  .middleware([contactServerErrorMiddleware, sameSiteMiddleware])
  .validator(contactMessageSchema)
  .handler(async ({ data }) => {
    const { assertSameOriginMutation } = await import("./admin-auth.server");
    assertSameOriginMutation();
    const { storeContactMessage } = await import("./contact.server");
    const { getRequestClientIdentifier } =
      await import("./request-client.server");
    const { applyRateLimitResponse } = await import("./rate-limit.server");
    try {
      await storeContactMessage(data, getRequestClientIdentifier());
    } catch (error) {
      applyRateLimitResponse(error);
      throw error;
    }
    // Delivery runs from the persisted outbox worker. The message is already
    // durably received even if SMTP is temporarily unavailable.
    return { success: true as const };
  });

export const listContactMessages = createServerFn({ method: "GET" })
  .middleware([contactServerErrorMiddleware, adminMiddleware])
  .validator(contactListSchema)
  .handler(async ({ data }) => {
    const { listContactMessageRecords } = await import("./contact.server");
    return listContactMessageRecords(data);
  });

export const setContactHandled = createServerFn({ method: "POST" })
  .middleware([contactServerErrorMiddleware, adminMiddleware])
  .validator(contactHandledSchema)
  .handler(async ({ data }) => {
    const { assertSameOriginMutation } = await import("./admin-auth.server");
    const { setContactHandledRecord } = await import("./contact.server");
    assertSameOriginMutation();
    return setContactHandledRecord(data.id, data.handled);
  });
