import { createMiddleware } from "@tanstack/react-start";

/** Verifies the signed admin cookie or an allowlisted Better Auth identity. */
export const adminMiddleware = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    const { getBearerToken } = await import("@/lib/auth/client");
    return next({ sendContext: { bearerToken: getBearerToken() ?? undefined } });
  })
  .server(async ({ next, context }) => {
    const { assertSameSiteRequest } = await import("@/lib/auth/isolation.server");
    const { requireAdmin } = await import("./admin-auth.server");
    assertSameSiteRequest();
    await requireAdmin(context.bearerToken);
    return next({ context: { bearerToken: context.bearerToken, isAdmin: true as const } });
  });
