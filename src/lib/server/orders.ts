import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { optionalAuthMiddleware } from "@/lib/auth/optional-middleware";
import { adminMiddleware } from "@/lib/server/admin-middleware";
import {
  adminOrderListSchema,
  createOrderSchema,
  orderIdSchema,
  orderViewerSchema,
  pricingPreviewSchema,
  updateOrderStatusSchema,
} from "@/lib/server/order-schema";
import { sameSiteMiddleware } from "@/lib/server/same-site-middleware";

export const GUEST_ORDER_COOKIE = "volt-order-access";

export const getPricingPreview = createServerFn({ method: "POST" })
  .middleware([sameSiteMiddleware])
  .validator(pricingPreviewSchema)
  .handler(async ({ data }) => {
    const { calculatePricing } = await import("./pricing");
    return calculatePricing(data);
  });

export const createOrder = createServerFn({ method: "POST" })
  .middleware([optionalAuthMiddleware])
  .validator(createOrderSchema)
  .handler(async ({ data, context }) => {
    const { setCookie } = await import("@tanstack/react-start/server");
    const {
      createOrderRecord,
      GUEST_ACCESS_TOKEN_TTL_MS,
      guestOrderCookieValue,
    } = await import("./orders.server");
    const { enforceOrderCreationLimit } = await import(
      "./abuse-protection.server"
    );
    const { getRequestClientIdentifier } = await import(
      "./request-client.server"
    );
    const { applyRateLimitResponse } = await import("./rate-limit.server");
    try {
      await enforceOrderCreationLimit(
        getRequestClientIdentifier(),
        data.email,
      );
    } catch (error) {
      applyRateLimitResponse(error);
      throw error;
    }
    const result = await createOrderRecord(data, { userId: context.userId });
    setCookie(
      GUEST_ORDER_COOKIE,
      guestOrderCookieValue(result.order.id, result.guestAccessToken),
      {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: Math.floor(GUEST_ACCESS_TOKEN_TTL_MS / 1_000),
      },
    );
    return result;
  });

export const getOrderForViewer = createServerFn({ method: "POST" })
  .middleware([optionalAuthMiddleware])
  .validator(orderViewerSchema)
  .handler(async ({ data, context }) => {
    const { getCookie, setCookie } = await import(
      "@tanstack/react-start/server"
    );
    const {
      GUEST_ACCESS_TOKEN_TTL_MS,
      getOrderRecordForViewer,
      guestOrderCookieValue,
      parseGuestOrderCookie,
    } = await import("./orders.server");
    const { isAdminViewer } = await import("./admin-auth.server");
    if (data.accessCode) {
      const { enforceOrderAccessLimit } = await import(
        "./abuse-protection.server"
      );
      const { getRequestClientIdentifier } = await import(
        "./request-client.server"
      );
      const { applyRateLimitResponse } = await import("./rate-limit.server");
      const orderReference = data.id ?? data.orderNumber ?? "unknown";
      try {
        await enforceOrderAccessLimit(
          getRequestClientIdentifier(),
          orderReference,
        );
      } catch (error) {
        applyRateLimitResponse(error);
        throw error;
      }
    }
    const cookie = parseGuestOrderCookie(getCookie(GUEST_ORDER_COOKIE));
    const order = await getOrderRecordForViewer({
      ...data,
      cookieOrderId: cookie?.orderId,
      cookieAccessToken: cookie?.token,
      userId: context.userId,
      isAdmin: await isAdminViewer(context.bearerToken),
    });

    if (data.accessCode) {
      setCookie(
        GUEST_ORDER_COOKIE,
        guestOrderCookieValue(order.id, data.accessCode),
        {
          httpOnly: true,
          sameSite: "strict",
          secure: process.env.NODE_ENV === "production",
          path: "/",
          maxAge: Math.floor(GUEST_ACCESS_TOKEN_TTL_MS / 1_000),
        },
      );
    }
    return order;
  });

export const listOwnOrders = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { listOwnOrderRecords } = await import("./orders.server");
    return listOwnOrderRecords(context.userId);
  });

export const listOrders = createServerFn({ method: "GET" })
  .middleware([adminMiddleware])
  .validator(adminOrderListSchema)
  .handler(async ({ data }) => {
    const { listAdminOrderRecords } = await import("./orders.server");
    return listAdminOrderRecords(data);
  });

export const getOrderForAdmin = createServerFn({ method: "GET" })
  .middleware([adminMiddleware])
  .validator(orderIdSchema)
  .handler(async ({ data }) => {
    const { getAdminOrderRecord } = await import("./orders.server");
    return getAdminOrderRecord(data.id);
  });

export const updateOrderStatus = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .validator(updateOrderStatusSchema)
  .handler(async ({ data }) => {
    const { assertSameOriginMutation } = await import("./admin-auth.server");
    const { updateOrderStatusRecord } = await import("./orders.server");
    assertSameOriginMutation();
    return updateOrderStatusRecord(
      data.id,
      data.expectedStatus,
      data.status,
    );
  });
