import { z } from "zod";

const collapseWhitespace = (value: string) => value.trim().replace(/\s+/g, " ");

const optionalText = (max: number) =>
  z.preprocess(
    (value) => {
      if (value == null) return undefined;
      if (typeof value !== "string") return value;
      const normalized = value.trim();
      return normalized ? normalized : undefined;
    },
    z.string().max(max).optional(),
  );

const countrySchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toUpperCase() : value),
  z.enum(["NL", "BE"]),
);

export const orderLineSchema = z.object({
  slug: z.string().trim().min(1).max(100),
  optionId: z.string().trim().min(1).max(100),
  qty: z.number().int().min(1).max(10),
});

export const pricingPreviewSchema = z
  .object({
    lines: z.array(orderLineSchema).min(1).max(50),
    discountCode: optionalText(64),
  })
  .strict();

export const createOrderSchema = z
  .object({
    name: z.string().min(1).max(120).transform(collapseWhitespace),
    email: z
      .string()
      .trim()
      .max(254)
      .email()
      .transform((value) => value.toLowerCase()),
    phone: optionalText(40),
    street: z.string().min(1).max(120).transform(collapseWhitespace),
    houseNumber: z.string().min(1).max(30).transform(collapseWhitespace),
    postcode: z
      .string()
      .trim()
      .min(3)
      .max(12)
      .transform((value) => {
        const compact = value.toUpperCase().replace(/\s+/g, "");
        return /^\d{4}[A-Z]{2}$/.test(compact)
          ? `${compact.slice(0, 4)} ${compact.slice(4)}`
          : compact;
      }),
    city: z.string().min(1).max(120).transform(collapseWhitespace),
    country: countrySchema,
    note: optionalText(1_000),
    lines: z.array(orderLineSchema).min(1).max(50),
    discountCode: optionalText(64),
    idempotencyKey: z.string().trim().min(16).max(200),
  })
  .strict();

export const orderViewerSchema = z
  .object({
    id: z.string().trim().min(1).max(100).optional(),
    orderNumber: z.string().trim().min(1).max(32).optional(),
    accessCode: z.string().trim().min(1).max(100).optional(),
  })
  .refine((value) => Boolean(value.id || value.orderNumber), {
    message: "Bestelling ontbreekt.",
  });

export const orderStatusSchema = z.enum([
  "pending",
  "paid",
  "packed",
  "shipped",
  "cancelled",
]);

export const adminOrderListSchema = z
  .object({
    search: z.string().trim().max(120).optional(),
    status: z.union([orderStatusSchema, z.literal("all")]).optional(),
    page: z.number().int().min(1).optional(),
    pageSize: z.number().int().min(1).max(50).optional(),
  })
  .strict();

export const orderIdSchema = z.object({
  id: z.string().trim().min(1).max(100),
});

export const updateOrderStatusSchema = orderIdSchema.extend({
  status: orderStatusSchema,
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type OrderViewerInput = z.infer<typeof orderViewerSchema>;
