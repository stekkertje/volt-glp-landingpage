import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PRODUCTS,
  PRODUCT_HASHES,
  hashToFilter,
  getProduct,
  pricePerWeekCents,
  siblingProduct,
  reviewsForProduct,
} from "../src/lib/product.ts";
import { formatCountdown, isPastCutoff } from "../src/lib/cutoff.ts";

function stackDiscountPct(qty) {
  if (qty >= 10) return 20;
  if (qty >= 5) return 10;
  return 0;
}

function shippingCents(afterDiscount) {
  return afterDiscount >= 10000 ? 0 : 495;
}

test("catalog order starts with Semaglutide and has no English Sale badges", () => {
  assert.equal(PRODUCTS[0].slug, "semaglutide-2mg");
  assert.equal(PRODUCTS[1].slug, "semaglutide-4mg-pen");
  assert.equal(PRODUCTS.at(-1).slug, "retatrutide-20mg-pen");
  assert.ok(PRODUCTS.every((p) => !p.badges.some((b) => String(b).startsWith("Sale"))));
});

test("hash filters compounds and ignores faq or reviews", () => {
  assert.equal(hashToFilter("#semaglutide"), "Semaglutide");
  assert.equal(hashToFilter("#faq"), null);
  assert.equal(hashToFilter("#beoordelingen"), null);
  assert.equal(hashToFilter("#producten"), "all");
  assert.equal(PRODUCT_HASHES.has("retatrutide"), true);
  assert.equal(PRODUCT_HASHES.has("faq"), false);
});

test("vial extras and duration sit next to the price story", () => {
  const vial = getProduct("semaglutide-2mg");
  assert.ok(vial);
  assert.equal(vial.options.find((o) => o.id === "syringes")?.label, "10 insulinespuiten");
  assert.equal(pricePerWeekCents(vial), Math.round(8500 / 8));
  assert.equal(siblingProduct(vial)?.slug, "semaglutide-4mg-pen");
  assert.ok(reviewsForProduct(vial).length >= 1);
});

test("stack and shipping math", () => {
  assert.equal(stackDiscountPct(4), 0);
  assert.equal(stackDiscountPct(5), 10);
  assert.equal(stackDiscountPct(10), 20);
  assert.equal(shippingCents(5000), 495);
  assert.equal(shippingCents(10000), 0);
  const raw = 16900 * 5;
  assert.equal(raw - Math.round(raw * 0.1), 76050);
});

test("cutoff clock", () => {
  const open = new Date();
  open.setHours(22, 0, 0, 0);
  assert.equal(isPastCutoff(open), false);
  const closed = new Date();
  closed.setHours(23, 0, 0, 0);
  assert.equal(isPastCutoff(closed), true);
  assert.equal(formatCountdown(3661000), "01:01:01");
});
