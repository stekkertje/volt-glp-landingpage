import { createServerFn } from "@tanstack/react-start";
import { adminMiddleware } from "@/lib/server/admin-middleware";
import {
  contactHandledSchema,
  contactListSchema,
  contactMessageSchema,
} from "@/lib/server/contact-schema";
import { sameSiteMiddleware } from "@/lib/server/same-site-middleware";

export const createContactMessage = createServerFn({ method: "POST" })
  .middleware([sameSiteMiddleware])
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
    return { success: true as const };
  });

export const listContactMessages = createServerFn({ method: "GET" })
  .middleware([adminMiddleware])
  .validator(contactListSchema)
  .handler(async ({ data }) => {
    const { listContactMessageRecords } = await import("./contact.server");
    return listContactMessageRecords(data);
  });

export const setContactHandled = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .validator(contactHandledSchema)
  .handler(async ({ data }) => {
    const { assertSameOriginMutation } = await import("./admin-auth.server");
    const { setContactHandledRecord } = await import("./contact.server");
    assertSameOriginMutation();
    return setContactHandledRecord(data.id, data.handled);
  });
