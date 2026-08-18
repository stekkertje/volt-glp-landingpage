import { z } from "zod";
import { ORDER_STATUSES } from "@/lib/order-status";

const collapseWhitespace = (value: string) => value.trim().replace(/\s+/g, " ");

const requiredText = (label: string, max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" ? collapseWhitespace(value) : value),
    z
      .string({ message: `${label} is verplicht.` })
      .min(1, { message: `${label} is verplicht.` })
      .max(max, { message: `${label} is te lang.` }),
  );

const optionalText = (max: number) =>
  z.preprocess(
    (value) => {
      if (value == null) return undefined;
      if (typeof value !== "string") return value;
      const normalized = collapseWhitespace(value);
      return normalized ? normalized : undefined;
    },
    z.string().max(max, { message: "Dit veld is te lang." }).optional(),
  );

const countrySchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toUpperCase() : value),
  z.enum(["NL", "BE"]),
);

export const orderLineSchema = z.object({
  slug: requiredText("Product", 100),
  optionId: requiredText("Productoptie", 100),
  qty: z
    .number({ message: "Aantal moet een getal zijn." })
    .int({ message: "Aantal moet een geheel getal zijn." })
    .min(1, { message: "Aantal moet minimaal 1 zijn." })
    .max(10, { message: "Aantal mag maximaal 10 zijn." }),
});

export const pricingPreviewSchema = z
  .object({
    lines: z.array(orderLineSchema).min(1).max(50),
    discountCode: optionalText(64),
  })
  .strict();

const createOrderBaseSchema = z
  .object({
    name: requiredText("Naam", 120),
    email: z.preprocess(
      (value) =>
        typeof value === "string" ? value.trim().toLowerCase() : value,
      z
        .string({ message: "E-mailadres is verplicht." })
        .min(1, { message: "E-mailadres is verplicht." })
        .max(254, { message: "E-mailadres is te lang." })
        .email({ message: "Vul een geldig e-mailadres in." }),
    ),
    phone: optionalText(40),
    street: requiredText("Straat", 120),
    houseNumber: requiredText("Huisnummer", 30),
    postcode: z.preprocess(
      (value) =>
        typeof value === "string"
          ? value.trim().toUpperCase().replace(/\s+/g, "")
          : value,
      z
        .string({ message: "Postcode is verplicht." })
        .min(1, { message: "Postcode is verplicht." })
        .max(8, { message: "Postcode is te lang." }),
    ),
    city: requiredText("Plaats", 120),
    country: countrySchema,
    note: optionalText(1_000),
    lines: z.array(orderLineSchema).min(1).max(50),
    discountCode: optionalText(64),
    idempotencyKey: z
      .string()
      .trim()
      .min(16, { message: "Herhaalcode is ongeldig." })
      .max(200, { message: "Herhaalcode is ongeldig." }),
  })
  .strict();

export const createOrderSchema = createOrderBaseSchema
  .superRefine((value, context) => {
    const valid =
      value.country === "NL"
        ? /^[1-9]\d{3}[A-Z]{2}$/.test(value.postcode)
        : /^[1-9]\d{3}$/.test(value.postcode);
    if (!valid) {
      context.addIssue({
        code: "custom",
        path: ["postcode"],
        message:
          value.country === "NL"
            ? "Vul een geldige Nederlandse postcode in."
            : "Vul een geldige Belgische postcode in.",
      });
    }
  })
  .transform((value) => ({
    ...value,
    postcode:
      value.country === "NL"
        ? `${value.postcode.slice(0, 4)} ${value.postcode.slice(4)}`
        : value.postcode,
  }));

export const orderViewerSchema = z
  .object({
    id: z.string().trim().min(1).max(100).optional(),
    orderNumber: z.string().trim().min(1).max(32).optional(),
    accessCode: z.string().trim().min(1).max(100).optional(),
  })
  .refine((value) => Boolean(value.id || value.orderNumber), {
    message: "Bestelling ontbreekt.",
  });

export const orderStatusSchema = z.enum(ORDER_STATUSES);

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
  expectedStatus: orderStatusSchema,
  status: orderStatusSchema,
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type OrderViewerInput = z.infer<typeof orderViewerSchema>;
