import { createMiddleware } from "@tanstack/react-start";

/** Blocks scripted cross-origin and sibling-site server-function requests. */
export const sameSiteMiddleware = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const { assertSameSiteRequest } = await import("@/lib/auth/isolation.server");
    assertSameSiteRequest();
    return next();
  },
);
