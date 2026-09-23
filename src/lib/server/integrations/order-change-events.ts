import type { OrderStatus } from "@/lib/order-status";

export const CUSTOMER_NOTIFICATION_EVENT_TYPES = [
  "products_changed",
  "address_changed",
  "status_changed",
] as const;

export type CustomerNotificationEventType =
  (typeof CUSTOMER_NOTIFICATION_EVENT_TYPES)[number];

export type OrderChangeEvent =
  | {
      type: "products_changed";
      orderId: string;
      dedupeKey: string;
      changedFulfillmentLineIds: string[];
    }
  | {
      type: "address_changed";
      orderId: string;
      dedupeKey: string;
      changedFields: Array<
        | "name"
        | "phone"
        | "street"
        | "houseNumber"
        | "postcode"
        | "city"
        | "country"
      >;
    }
  | {
      type: "status_changed";
      orderId: string;
      dedupeKey: string;
      previousStatus: OrderStatus;
      nextStatus: OrderStatus;
    };

export function shouldNotifyCustomer(event: {
  type: string;
}): event is OrderChangeEvent {
  return CUSTOMER_NOTIFICATION_EVENT_TYPES.includes(
    event.type as CustomerNotificationEventType,
  );
}
