import { z } from "zod";

const requiredText = (label: string, max: number, min = 1) =>
  z.preprocess(
    (value) =>
      typeof value === "string" ? value.trim().replace(/\s+/g, " ") : value,
    z
      .string({ message: `${label} is verplicht.` })
      .min(min, {
        message:
          min === 1
            ? `${label} is verplicht.`
            : `${label} moet minimaal ${min} tekens bevatten.`,
      })
      .max(max, { message: `${label} is te lang.` }),
  );

export const contactMessageSchema = z
  .object({
    name: requiredText("Naam", 120, 3),
    email: z.preprocess(
      (value) =>
        typeof value === "string" ? value.trim().toLowerCase() : value,
      z
        .string({ message: "E-mailadres is verplicht." })
        .min(1, { message: "E-mailadres is verplicht." })
        .max(254, { message: "E-mailadres is te lang." })
        .email({ message: "Vul een geldig e-mailadres in." })
        .regex(/^[^\s@]{2,}@[^\s@]+\.[A-Za-z]{2,}$/, {
          message: "Vul een geldig e-mailadres in.",
        }),
    ),
    message: z.preprocess(
      (value) => (typeof value === "string" ? value.trim() : value),
      z
        .string({ message: "Bericht is verplicht." })
        .min(10, { message: "Schrijf minimaal 10 tekens." })
        .max(4_000, { message: "Bericht mag maximaal 4000 tekens bevatten." }),
    ),
  })
  .strict();

export const contactListSchema = z
  .object({
    handled: z.boolean().optional(),
    page: z.number().int().min(1).optional(),
    pageSize: z.number().int().min(1).max(50).optional(),
  })
  .strict();

export const contactHandledSchema = z
  .object({
    id: z.string().trim().min(1).max(100),
    handled: z.boolean(),
  })
  .strict();

export type ContactMessageInput = z.infer<typeof contactMessageSchema>;
export type ContactListInput = z.infer<typeof contactListSchema>;
