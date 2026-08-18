import { z } from "zod";

export const contactMessageSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(120)
      .transform((value) => value.trim().replace(/\s+/g, " ")),
    email: z
      .string()
      .trim()
      .max(254)
      .email()
      .transform((value) => value.toLowerCase()),
    message: z.string().trim().min(10).max(4_000),
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
