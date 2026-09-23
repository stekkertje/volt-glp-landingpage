/** Codes the cart UI may apply locally. Server still checks discount_codes. */
export const KNOWN_DISCOUNT_CODES = ["AFSLANK10", "VOLT10"] as const;

export function isKnownDiscountCode(code: string) {
  return (KNOWN_DISCOUNT_CODES as readonly string[]).includes(
    code.trim().toUpperCase(),
  );
}
