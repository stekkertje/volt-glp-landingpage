import { createMiddleware } from "@tanstack/react-start";

/** Verifies the signed admin cookie or an allowlisted Better Auth identity. */
export const adminMiddleware = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    const { getBearerToken } = await import("@/lib/auth/client");
    return next({ sendContext: { bearerToken: getBearerToken() ?? undefined } });
  })
  .server(async ({ next, context }) => {
    const { setResponseHeader, setResponseStatus } = await import(
      "@tanstack/react-start/server"
    );
    const { assertSameSiteRequest } = await import("@/lib/auth/isolation.server");
    const { requireAdmin } = await import("./admin-auth.server");
    assertSameSiteRequest();
    setResponseHeader("cache-control", "no-store");
    try {
      await requireAdmin(context.bearerToken);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "status" in error &&
        error.status === 401
      ) {
        setResponseStatus(401);
      }
      throw error;
    }
    return next({ context: { bearerToken: context.bearerToken, isAdmin: true as const } });
  });
