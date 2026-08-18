import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { optionalAuthMiddleware } from "@/lib/auth/optional-middleware";
import { adminMiddleware } from "@/lib/server/admin-middleware";
import { sameSiteMiddleware } from "@/lib/server/same-site-middleware";

const adminLoginSchema = z
  .object({
    password: z.string().min(1).max(1_024),
  })
  .strict();

export const getAdminSessionState = createServerFn({ method: "GET" })
  .middleware([optionalAuthMiddleware])
  .handler(async ({ context }) => {
    const { isAdminViewer } = await import("./admin-auth.server");
    return { authenticated: await isAdminViewer(context.bearerToken) };
  });

export const loginAdmin = createServerFn({ method: "POST" })
  .middleware([sameSiteMiddleware])
  .validator(adminLoginSchema)
  .handler(async ({ data }) => {
    const { loginAdminWithPassword } = await import("./admin-auth.server");
    await loginAdminWithPassword(data.password);
    return { success: true as const };
  });

export const logoutAdmin = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .handler(async () => {
    const { logoutAdminSession } = await import("./admin-auth.server");
    logoutAdminSession();
    return { success: true as const };
  });
