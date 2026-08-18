import { createMiddleware } from "@tanstack/react-start";

/**
 * Same-origin guard plus optional Better Auth identity for guest-capable flows.
 * Signed-out visitors remain valid callers; a verified session is attached when
 * one exists, including the bearer-token path used by the embedded preview.
 */
export const optionalAuthMiddleware = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    const { getBearerToken } = await import("./client");
    return next({ sendContext: { bearerToken: getBearerToken() ?? undefined } });
  })
  .server(async ({ next, context }) => {
    const { assertSameSiteRequest } = await import("./isolation.server");
    const { getSessionUser } = await import("./verify.server");
    assertSameSiteRequest();
    const user = await getSessionUser(context.bearerToken);
    return next({
      context: {
        userId: user?.id ?? null,
        userEmail: user?.email ?? null,
        bearerToken: context.bearerToken,
      },
    });
  });
