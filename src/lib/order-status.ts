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
