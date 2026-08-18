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
    const { getAdminCapabilities, isAdminViewer } = await import(
      "./admin-auth.server"
    );
    return {
      authenticated: await isAdminViewer(context.bearerToken),
      ...getAdminCapabilities(),
    };
  });

export const getAdminSummary = createServerFn({ method: "GET" })
  .middleware([adminMiddleware])
  .handler(async () => {
    const { getAdminSummaryRecord } = await import(
      "./admin-dashboard.server"
    );
    return getAdminSummaryRecord();
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
