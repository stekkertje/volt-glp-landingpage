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
const GUEST_COOKIE_SECONDS = 3 * 24 * 60 * 60;

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
    const { createOrderRecord, guestOrderCookieValue } = await import(
      "./orders.server"
    );
    const result = await createOrderRecord(data, { userId: context.userId });
    setCookie(
      GUEST_ORDER_COOKIE,
      guestOrderCookieValue(result.order.id, result.guestAccessToken),
      {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: GUEST_COOKIE_SECONDS,
      },
    );
    return result;
  });

export const getOrderForViewer = createServerFn({ method: "POST" })
  .middleware([optionalAuthMiddleware])
  .validator(orderViewerSchema)
  .handler(async ({ data, context }) => {
    const { getCookie, setCookie } = await import("@tanstack/react-start/server");
    const {
      getOrderRecordForViewer,
      guestOrderCookieValue,
      parseGuestOrderCookie,
    } = await import("./orders.server");
    const { isAdminViewer } = await import("./admin-auth.server");
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
          maxAge: GUEST_COOKIE_SECONDS,
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
    return updateOrderStatusRecord(data.id, data.status);
  });
