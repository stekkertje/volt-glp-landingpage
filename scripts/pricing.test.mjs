import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let vite;
let calculatePricing;

const activeCodes = new Map([
  ["VOLT10", { code: "VOLT10", percent: 10, active: true }],
]);
const resolveCode = async (code) => activeCodes.get(code) ?? null;

before(async () => {
  vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ calculatePricing } = await vite.ssrLoadModule(
    "/src/lib/server/pricing.ts",
  ));
});

after(async () => {
  await vite?.close();
});

test("pricing calculates a normal one-item order", async () => {
  const result = await calculatePricing(
    { lines: [{ slug: "semaglutide-2mg", optionId: "none", qty: 1 }] },
    resolveCode,
  );

  assert.equal(result.subtotalCents, 8500);
  assert.equal(result.stackDiscountCents, 0);
  assert.equal(result.codeDiscountCents, 0);
  assert.equal(result.shippingCents, 495);
  assert.equal(result.totalCents, 8995);
  assert.equal(result.lines[0].name, "Semaglutide 2mg");
  assert.equal(result.lines[0].optionLabel, "Geen extra's");
});

test("pricing applies ten percent stack discount at five items", async () => {
  const result = await calculatePricing(
    { lines: [{ slug: "semaglutide-2mg", optionId: "none", qty: 5 }] },
    resolveCode,
  );

  assert.equal(result.subtotalCents, 42_500);
  assert.equal(result.stackDiscountCents, 4_250);
  assert.equal(result.totalCents, 38_250);
});

test("pricing applies twenty percent stack discount at ten items", async () => {
  const result = await calculatePricing(
    { lines: [{ slug: "semaglutide-2mg", optionId: "none", qty: 10 }] },
    resolveCode,
  );

  assert.equal(result.subtotalCents, 85_000);
  assert.equal(result.stackDiscountCents, 17_000);
  assert.equal(result.totalCents, 68_000);
});

test("pricing coalesces duplicate variants before totals and discounts", async () => {
  const result = await calculatePricing(
    {
      lines: [
        { slug: "semaglutide-2mg", optionId: "none", qty: 2 },
        { slug: "semaglutide-2mg", optionId: "none", qty: 3 },
      ],
    },
    resolveCode,
  );

  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0].qty, 5);
  assert.equal(result.lines[0].lineTotalCents, 42_500);
  assert.equal(result.subtotalCents, 42_500);
  assert.equal(result.stackDiscountCents, 4_250);
});

test("pricing rejects a duplicate variant above the combined line cap", async () => {
  await assert.rejects(
    calculatePricing(
      {
        lines: [
          { slug: "semaglutide-2mg", optionId: "none", qty: 6 },
          { slug: "semaglutide-2mg", optionId: "none", qty: 5 },
        ],
      },
      resolveCode,
    ),
    /maximaal 10 stuks/i,
  );
});

test("VOLT10 is calculated after the stack discount", async () => {
  const result = await calculatePricing(
    {
      lines: [{ slug: "semaglutide-2mg", optionId: "none", qty: 5 }],
      discountCode: " volt10 ",
    },
    resolveCode,
  );

  assert.equal(result.stackDiscountCents, 4_250);
  assert.equal(result.codeDiscountCents, 3_825);
  assert.equal(result.discountCode, "VOLT10");
  assert.equal(result.totalCents, 34_425);
});

test("shipping is 495 cents below 100 euro and free from 100 euro", async () => {
  const paidShipping = await calculatePricing(
    { lines: [{ slug: "retatrutide-10mg", optionId: "none", qty: 1 }] },
    resolveCode,
  );
  const freeShipping = await calculatePricing(
    { lines: [{ slug: "semaglutide-4mg-pen", optionId: "default", qty: 1 }] },
    resolveCode,
  );

  assert.equal(paidShipping.shippingCents, 495);
  assert.equal(freeShipping.shippingCents, 0);
});

test("pricing rejects an unknown product slug", async () => {
  await assert.rejects(
    calculatePricing(
      { lines: [{ slug: "bestaat-niet", optionId: "none", qty: 1 }] },
      resolveCode,
    ),
    /product/i,
  );
});

test("pricing rejects an invalid product option", async () => {
  await assert.rejects(
    calculatePricing(
      {
        lines: [{ slug: "semaglutide-2mg", optionId: "bestaat-niet", qty: 1 }],
      },
      resolveCode,
    ),
    /optie/i,
  );
});

for (const qty of [0, 11, 1.5]) {
  test(`pricing rejects invalid quantity ${qty}`, async () => {
    await assert.rejects(
      calculatePricing(
        { lines: [{ slug: "semaglutide-2mg", optionId: "none", qty }] },
        resolveCode,
      ),
      /aantal/i,
    );
  });
}

test("pricing rejects unknown and inactive discount codes", async () => {
  await assert.rejects(
    calculatePricing(
      {
        lines: [{ slug: "semaglutide-2mg", optionId: "none", qty: 1 }],
        discountCode: "ONBEKEND",
      },
      resolveCode,
    ),
    /kortingscode/i,
  );

  await assert.rejects(
    calculatePricing(
      {
        lines: [{ slug: "semaglutide-2mg", optionId: "none", qty: 1 }],
        discountCode: "INACTIEF",
      },
      async () => ({ code: "INACTIEF", percent: 10, active: false }),
    ),
    /kortingscode/i,
  );
});
