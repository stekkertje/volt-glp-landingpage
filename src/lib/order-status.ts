export const ORDER_STATUSES = [
  "pending",
  "paid",
  "packed",
  "shipped",
  "cancelled",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "In afwachting",
  paid: "Betaald",
  packed: "Ingepakt",
  shipped: "Verzonden",
  cancelled: "Geannuleerd",
};

export const ALLOWED_ORDER_STATUS_TRANSITIONS: Record<
  OrderStatus,
  readonly OrderStatus[]
> = {
  pending: ["paid", "cancelled"],
  paid: ["packed", "cancelled"],
  packed: ["shipped"],
  shipped: [],
  cancelled: [],
};

export function isOrderStatusTransitionAllowed(
  current: OrderStatus,
  next: OrderStatus,
): boolean {
  return ALLOWED_ORDER_STATUS_TRANSITIONS[current].includes(next);
}
