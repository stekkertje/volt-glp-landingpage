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
  updateOrderAddressSchema,
  updateOrderFulfillmentSchema,
  updateOrderStatusSchema,
} from "@/lib/server/order-schema";
import { sameSiteMiddleware } from "@/lib/server/same-site-middleware";
import {
  createPublicServerErrorMiddleware,
  ORDER_CONFLICT_ERROR_MESSAGE,
  type PublicServerErrorPolicy,
} from "@/lib/server-error";

export const ORDER_SERVER_ERROR_POLICY = {
  fallbackMessage: "De bestelling kon niet worden verwerkt.",
  allowedNames: new Set([
    "IdempotencyReplayExpiredError",
    "IdempotencyReplayUnavailableError",
    "AddressValidationTokenError",
    "OrderAccessError",
    "OrderAddressLockedError",
    "OrderFulfillmentError",
    "OrderFulfillmentLockedError",
    "OrderStatusConflictError",
    "OrderStatusTransitionError",
    "OrderUpdateConflictError",
    "PricingError",
    "ShipmentActionError",
  ]),
  messageByName: {
    IdempotencyConflictError: ORDER_CONFLICT_ERROR_MESSAGE,
  },
  statusByName: {
    IdempotencyConflictError: 409,
    IdempotencyReplayExpiredError: 410,
    IdempotencyReplayUnavailableError: 503,
    AddressValidationTokenError: 400,
    OrderAccessError: 404,
    OrderAddressLockedError: 409,
    OrderFulfillmentError: 400,
    OrderFulfillmentLockedError: 409,
    OrderStatusConflictError: 409,
    OrderStatusTransitionError: 409,
    OrderUpdateConflictError: 409,
    PricingError: 400,
    ShipmentActionError: 400,
  },
} satisfies PublicServerErrorPolicy;

const orderServerErrorMiddleware = createPublicServerErrorMiddleware(
  ORDER_SERVER_ERROR_POLICY,
);

export const GUEST_ORDER_COOKIE = "__Host-volt-order-access";

const ORDER_ID_COOKIE_SUFFIX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function guestOrderCookieName(orderId: string): string {
  const normalized = orderId.trim().toLowerCase();
  return `${GUEST_ORDER_COOKIE}-${
    ORDER_ID_COOKIE_SUFFIX.test(normalized) ? normalized : "invalid"
  }`;
}

export const getPricingPreview = createServerFn({ method: "POST" })
  .middleware([orderServerErrorMiddleware, sameSiteMiddleware])
  .validator(pricingPreviewSchema)
  .handler(async ({ data }) => {
    const { enforcePricingPreviewLimit } =
      await import("./abuse-protection.server");
    const { getRequestClientIdentifier } =
      await import("./request-client.server");
    const { applyRateLimitResponse } = await import("./rate-limit.server");
    try {
      await enforcePricingPreviewLimit(getRequestClientIdentifier());
    } catch (error) {
      applyRateLimitResponse(error);
      throw error;
    }
    const { calculatePricing } = await import("./pricing");
    return calculatePricing(data);
  });

export const createOrder = createServerFn({ method: "POST" })
  .middleware([orderServerErrorMiddleware, optionalAuthMiddleware])
  .validator(createOrderSchema)
  .handler(async ({ data, context }) => {
    const { assertSameOriginMutation } = await import("./admin-auth.server");
    assertSameOriginMutation();
    const { setCookie } = await import("@tanstack/react-start/server");
    const {
      createOrderRecord,
      GUEST_ACCESS_TOKEN_TTL_MS,
      guestOrderCookieValue,
    } = await import("./orders.server");
    const { enforceOrderCreationLimit } =
      await import("./abuse-protection.server");
    const { getRequestClientIdentifier } =
      await import("./request-client.server");
    const { applyRateLimitResponse } = await import("./rate-limit.server");
    try {
      await enforceOrderCreationLimit(getRequestClientIdentifier(), data.email);
    } catch (error) {
      applyRateLimitResponse(error);
      throw error;
    }
    const result = await createOrderRecord(data, { userId: context.userId });
    setCookie(
      guestOrderCookieName(result.order.id),
      guestOrderCookieValue(result.order.id, result.guestAccessToken),
      {
        httpOnly: true,
        sameSite: "strict",
        secure: true,
        path: "/",
        maxAge: Math.floor(GUEST_ACCESS_TOKEN_TTL_MS / 1_000),
      },
    );
    return { order: result.order, replayed: result.replayed };
  });

export const getOrderForViewer = createServerFn({ method: "POST" })
  .middleware([orderServerErrorMiddleware, optionalAuthMiddleware])
  .validator(orderViewerSchema)
  .handler(async ({ data, context }) => {
    const { getCookie } = await import("@tanstack/react-start/server");
    const { getOrderRecordForViewer, parseGuestOrderCookie } =
      await import("./orders.server");
    const { isAdminViewer } = await import("./admin-auth.server");
    if (!context.userId) {
      const { enforceOrderAccessLimit } =
        await import("./abuse-protection.server");
      const { getRequestClientIdentifier } =
        await import("./request-client.server");
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
    const cookie = parseGuestOrderCookie(
      (data.id ? getCookie(guestOrderCookieName(data.id)) : null) ??
        getCookie(GUEST_ORDER_COOKIE),
    );
    const order = await getOrderRecordForViewer({
      ...data,
      cookieOrderId: cookie?.orderId,
      cookieAccessToken: cookie?.token,
      userId: context.userId,
      isAdmin: await isAdminViewer(context.bearerToken),
    });

    return order;
  });

export const listOwnOrders = createServerFn({ method: "GET" })
  .middleware([orderServerErrorMiddleware, authMiddleware])
  .handler(async ({ context }) => {
    const { listOwnOrderRecords } = await import("./orders.server");
    return listOwnOrderRecords(context.userId);
  });

export const listOrders = createServerFn({ method: "GET" })
  .middleware([orderServerErrorMiddleware, adminMiddleware])
  .validator(adminOrderListSchema)
  .handler(async ({ data }) => {
    const { listAdminOrderRecords } = await import("./orders.server");
    return listAdminOrderRecords(data);
  });

export const getOrderForAdmin = createServerFn({ method: "GET" })
  .middleware([orderServerErrorMiddleware, adminMiddleware])
  .validator(orderIdSchema)
  .handler(async ({ data }) => {
    const { getAdminOrderRecord } = await import("./orders.server");
    return getAdminOrderRecord(data.id);
  });

export const updateOrderStatus = createServerFn({ method: "POST" })
  .middleware([orderServerErrorMiddleware, adminMiddleware])
  .validator(updateOrderStatusSchema)
  .handler(async ({ data }) => {
    const { assertSameOriginMutation } = await import("./admin-auth.server");
    const { updateOrderStatusRecord } = await import("./orders.server");
    assertSameOriginMutation();
    return updateOrderStatusRecord(data.id, data.expectedStatus, data.status);
  });

export const updateOrderAddress = createServerFn({ method: "POST" })
  .middleware([orderServerErrorMiddleware, adminMiddleware])
  .validator(updateOrderAddressSchema)
  .handler(async ({ data }) => {
    const { assertSameOriginMutation } = await import("./admin-auth.server");
    const { updateOrderAddressRecord } = await import("./orders.server");
    assertSameOriginMutation();
    return updateOrderAddressRecord(data);
  });

export const updateOrderFulfillment = createServerFn({ method: "POST" })
  .middleware([orderServerErrorMiddleware, adminMiddleware])
  .validator(updateOrderFulfillmentSchema)
  .handler(async ({ data }) => {
    const { assertSameOriginMutation } = await import("./admin-auth.server");
    const { updateOrderFulfillmentRecord } = await import("./orders.server");
    assertSameOriginMutation();
    return updateOrderFulfillmentRecord(data);
  });

export const createMyParcelConcept = createServerFn({ method: "POST" })
  .middleware([orderServerErrorMiddleware, adminMiddleware])
  .validator(orderIdSchema)
  .handler(async ({ data }) => {
    const { assertSameOriginMutation } = await import("./admin-auth.server");
    const { createMyParcelConceptRecord } = await import("./shipping.server");
    assertSameOriginMutation();
    return createMyParcelConceptRecord(data.id);
  });

export const requestMyParcelLabel = createServerFn({ method: "POST" })
  .middleware([orderServerErrorMiddleware, adminMiddleware])
  .validator(orderIdSchema)
  .handler(async ({ data }) => {
    const { assertSameOriginMutation } = await import("./admin-auth.server");
    const { requestMyParcelLabelRecord } = await import("./shipping.server");
    assertSameOriginMutation();
    return requestMyParcelLabelRecord(data.id);
  });

export const refreshMyParcelTracking = createServerFn({ method: "POST" })
  .middleware([orderServerErrorMiddleware, adminMiddleware])
  .validator(orderIdSchema)
  .handler(async ({ data }) => {
    const { assertSameOriginMutation } = await import("./admin-auth.server");
    const { refreshMyParcelTrackingRecord } = await import("./shipping.server");
    assertSameOriginMutation();
    return refreshMyParcelTrackingRecord(data.id);
  });
