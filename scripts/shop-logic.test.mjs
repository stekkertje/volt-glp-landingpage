import test from "node:test";
import assert from "node:assert/strict";

function hashToFilter(hash) {
  const h = hash.replace("#", "").toLowerCase();
  if (h === "semaglutide") return "Semaglutide";
  if (h === "tirzepatide") return "Tirzepatide";
  if (h === "retatrutide") return "Retatrutide";
  if (h === "producten") return "all";
  return null;
}

function stackDiscountPct(qty) {
  if (qty >= 10) return 20;
  if (qty >= 5) return 10;
  return 0;
}

function cartShippingCents(subtotalAfterDiscount, freeShippingCents = 10000) {
  return subtotalAfterDiscount >= freeShippingCents ? 0 : 495;
}

function pricePerWeekCents(priceCents, weeksAtStart) {
  return Math.round(priceCents / weeksAtStart);
}

test("hashToFilter maps compound hashes and ignores faq", () => {
  assert.equal(hashToFilter("#semaglutide"), "Semaglutide");
  assert.equal(hashToFilter("/#tirzepatide".slice("/#tirzepatide".indexOf("#"))), "Tirzepatide");
  assert.equal(hashToFilter("#retatrutide"), "Retatrutide");
  assert.equal(hashToFilter("#producten"), "all");
  assert.equal(hashToFilter("#faq"), null);
  assert.equal(hashToFilter("#beoordelingen"), null);
  assert.equal(hashToFilter(""), null);
});

test("stapelkorting tiers", () => {
  assert.equal(stackDiscountPct(1), 0);
  assert.equal(stackDiscountPct(4), 0);
  assert.equal(stackDiscountPct(5), 10);
  assert.equal(stackDiscountPct(9), 10);
  assert.equal(stackDiscountPct(10), 20);
});

test("verzending gratis vanaf 100 euro", () => {
  assert.equal(cartShippingCents(9999), 495);
  assert.equal(cartShippingCents(10000), 0);
  assert.equal(cartShippingCents(16900), 0);
});

test("prijs per week bij startdosis", () => {
  assert.equal(pricePerWeekCents(16900, 16), 1056);
  assert.equal(pricePerWeekCents(7760, 4), 1940);
  assert.equal(pricePerWeekCents(8500, 8), 1063);
});
