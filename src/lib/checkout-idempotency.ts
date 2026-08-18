import type { CreateOrderInput } from "@/lib/server/order-schema";

type CheckoutPayload = Omit<CreateOrderInput, "idempotencyKey">;

export type CheckoutIdempotencyState = {
  payloadHash: string;
  key: string;
};

function compareVariant(
  left: { slug: string; optionId: string },
  right: { slug: string; optionId: string },
): number {
  const leftKey = `${left.slug}\0${left.optionId}`;
  const rightKey = `${right.slug}\0${right.optionId}`;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function canonicalLines(lines: CheckoutPayload["lines"]) {
  const quantities = new Map<
    string,
    { slug: string; optionId: string; qty: number }
  >();
  for (const line of lines) {
    const key = `${line.slug}\0${line.optionId}`;
    const existing = quantities.get(key);
    quantities.set(key, {
      slug: line.slug,
      optionId: line.optionId,
      qty: (existing?.qty ?? 0) + line.qty,
    });
  }
  return [...quantities.values()].sort(compareVariant);
}

export function canonicalCheckoutPayload(input: CheckoutPayload): string {
  return JSON.stringify({
    name: input.name,
    email: input.email,
    phone: input.phone ?? null,
    street: input.street,
    houseNumber: input.houseNumber,
    postcode: input.postcode,
    city: input.city,
    country: input.country,
    note: input.note ?? null,
    discountCode: input.discountCode?.trim().toUpperCase() || null,
    lines: canonicalLines(input.lines),
  });
}

export async function checkoutPayloadHash(
  input: CheckoutPayload,
): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalCheckoutPayload(input)),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function checkoutIdempotencyForPayload(
  input: CheckoutPayload,
  current: CheckoutIdempotencyState | null,
  createKey: () => string = () => globalThis.crypto.randomUUID(),
): Promise<CheckoutIdempotencyState> {
  const payloadHash = await checkoutPayloadHash(input);
  return current?.payloadHash === payloadHash
    ? current
    : { payloadHash, key: createKey() };
}
