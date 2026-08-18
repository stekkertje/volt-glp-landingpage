import {
  SITE,
  getOption,
  getProduct,
  unitPriceCents,
  type ProductSlug,
} from "@/lib/product";

export type PricingLineInput = {
  slug: string;
  optionId: string;
  qty: number;
};

export type PricingInput = {
  lines: PricingLineInput[];
  discountCode?: string | null;
};

export type DiscountCodeRecord = {
  code: string;
  percent: number;
  active: boolean;
};

export type PricedLine = {
  slug: ProductSlug;
  optionId: string;
  name: string;
  optionLabel: string;
  unitPriceCents: number;
  qty: number;
  lineTotalCents: number;
};

export type PricingResult = {
  lines: PricedLine[];
  subtotalCents: number;
  stackDiscountCents: number;
  codeDiscountCents: number;
  shippingCents: number;
  totalCents: number;
  discountCode: string | null;
};

export type DiscountCodeResolver = (
  code: string,
) => Promise<DiscountCodeRecord | null>;

export class PricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PricingError";
  }
}

async function resolveDiscountCodeFromDatabase(
  code: string,
): Promise<DiscountCodeRecord | null> {
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  const rows = await sql<DiscountCodeRecord>`
    select code, percent, active
    from discount_codes
    where code = ${code}
    limit 1
  `;
  return rows[0] ?? null;
}

function normalizeLine(line: PricingLineInput): PricedLine {
  if (!Number.isInteger(line.qty) || line.qty < 1 || line.qty > 10) {
    throw new PricingError("Het aantal per product moet een geheel getal van 1 tot en met 10 zijn.");
  }

  const product = getProduct(line.slug);
  if (!product) {
    throw new PricingError("Een product in je winkelwagen bestaat niet.");
  }

  const hasValidOption = product.options.length
    ? product.options.some((option) => option.id === line.optionId)
    : line.optionId === "default";
  if (!hasValidOption) {
    throw new PricingError(`De gekozen optie voor ${product.name} bestaat niet.`);
  }

  const option = getOption(product, line.optionId);
  const unitPrice = unitPriceCents(product, line.optionId);
  return {
    slug: product.slug,
    optionId: line.optionId,
    name: product.name,
    optionLabel: option?.label ?? product.unit,
    unitPriceCents: unitPrice,
    qty: line.qty,
    lineTotalCents: unitPrice * line.qty,
  };
}

export async function calculatePricing(
  input: PricingInput,
  resolveDiscountCode: DiscountCodeResolver = resolveDiscountCodeFromDatabase,
): Promise<PricingResult> {
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new PricingError("Je winkelwagen is leeg.");
  }
  if (input.lines.length > 50) {
    throw new PricingError("Je winkelwagen bevat te veel productregels.");
  }

  const lines = input.lines.map(normalizeLine);
  const subtotalCents = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
  const totalQty = lines.reduce((sum, line) => sum + line.qty, 0);
  const stackPercent = totalQty >= 10 ? 20 : totalQty >= 5 ? 10 : 0;
  const stackDiscountCents = Math.round(subtotalCents * (stackPercent / 100));
  const afterStackCents = subtotalCents - stackDiscountCents;

  const normalizedCode = input.discountCode?.trim().toUpperCase() || null;
  let codeDiscountCents = 0;
  let appliedCode: string | null = null;
  if (normalizedCode) {
    const discount = await resolveDiscountCode(normalizedCode);
    if (!discount?.active || discount.code.toUpperCase() !== normalizedCode) {
      throw new PricingError("De kortingscode is niet geldig.");
    }
    codeDiscountCents = Math.round(afterStackCents * (discount.percent / 100));
    appliedCode = normalizedCode;
  }

  const afterDiscountCents = afterStackCents - codeDiscountCents;
  const shippingCents = afterDiscountCents < SITE.freeShippingCents ? 495 : 0;
  const totalCents = afterDiscountCents + shippingCents;

  return {
    lines,
    subtotalCents,
    stackDiscountCents,
    codeDiscountCents,
    shippingCents,
    totalCents,
    discountCode: appliedCode,
  };
}
