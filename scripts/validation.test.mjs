import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let vite;
let createOrderSchema;
let contactMessageSchema;

function validOrder(overrides = {}) {
  return {
    name: "Noor de Vries",
    email: "noor@example.test",
    phone: "",
    street: "Teststraat",
    houseNumber: "12 A",
    postcode: "1234 AB",
    city: "Utrecht",
    country: "NL",
    note: "",
    lines: [{ slug: "semaglutide-2mg", optionId: "none", qty: 1 }],
    discountCode: "",
    idempotencyKey: "0123456789abcdef",
    ...overrides,
  };
}

before(async () => {
  vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ createOrderSchema } = await vite.ssrLoadModule(
    "/src/lib/server/order-schema.ts",
  ));
  ({ contactMessageSchema } = await vite.ssrLoadModule(
    "/src/lib/server/contact-schema.ts",
  ));
});

after(async () => {
  await vite?.close();
});

for (const field of ["name", "street", "houseNumber", "city"]) {
  test(`order validation rejects whitespace-only ${field}`, () => {
    const result = createOrderSchema.safeParse(validOrder({ [field]: "   " }));
    assert.equal(result.success, false);
    assert.ok(result.error.issues.some((issue) => issue.path[0] === field));
  });
}

test("contact validation rejects a whitespace-only name", () => {
  const result = contactMessageSchema.safeParse({
    name: "   ",
    email: "noor@example.test",
    message: "Dit bericht is lang genoeg.",
  });
  assert.equal(result.success, false);
  assert.ok(result.error.issues.some((issue) => issue.path[0] === "name"));
});

test("contact validation requires a useful name and e-mail address", () => {
  for (const input of [
    { name: "A", email: "noor@example.nl" },
    { name: "Noor", email: "n@example.nl" },
    { name: "Noor", email: "noor@example" },
    { name: "Noor", email: "noor@example.x" },
  ]) {
    const result = contactMessageSchema.safeParse({
      ...input,
      message: "Dit bericht is lang genoeg.",
    });
    assert.equal(result.success, false, JSON.stringify(input));
  }

  assert.equal(
    contactMessageSchema.safeParse({
      name: "Noa",
      email: "noor@example.nl",
      message: "Dit bericht is lang genoeg.",
    }).success,
    true,
  );
});

test("order validation normalizes and validates Dutch postcodes", () => {
  const valid = createOrderSchema.safeParse(validOrder({ postcode: "1234ab" }));
  assert.equal(valid.success, true);
  assert.equal(valid.data.postcode, "1234 AB");

  for (const postcode of ["abc", "0123 AB", "1234", "12345 AB"]) {
    const invalid = createOrderSchema.safeParse(validOrder({ postcode }));
    assert.equal(invalid.success, false, postcode);
    assert.ok(
      invalid.error.issues.some((issue) => issue.path[0] === "postcode"),
    );
  }
});

test("order validation validates Belgian postcodes against the selected country", () => {
  const valid = createOrderSchema.safeParse(
    validOrder({ country: "be", postcode: "1000" }),
  );
  assert.equal(valid.success, true);
  assert.equal(valid.data.country, "BE");
  assert.equal(valid.data.postcode, "1000");

  for (const postcode of ["0000", "1234 AB", "999", "10000"]) {
    const invalid = createOrderSchema.safeParse(
      validOrder({ country: "BE", postcode }),
    );
    assert.equal(invalid.success, false, postcode);
    assert.ok(
      invalid.error.issues.some((issue) => issue.path[0] === "postcode"),
    );
  }
});

test("order required-field limits apply after normalization", () => {
  assert.equal(
    createOrderSchema.safeParse(validOrder({ name: ` ${"a".repeat(120)} ` }))
      .success,
    true,
  );
  assert.equal(
    createOrderSchema.safeParse(validOrder({ name: ` ${"a".repeat(121)} ` }))
      .success,
    false,
  );
});

test("contact field limits apply after trimming", () => {
  assert.equal(
    contactMessageSchema.safeParse({
      name: ` ${"a".repeat(120)} `,
      email: "noor@example.test",
      message: "1234567890",
    }).success,
    true,
  );
  assert.equal(
    contactMessageSchema.safeParse({
      name: ` ${"a".repeat(121)} `,
      email: "noor@example.test",
      message: "1234567890",
    }).success,
    false,
  );
  assert.equal(
    contactMessageSchema.safeParse({
      name: "Noor",
      email: "noor@example.test",
      message: "123456789",
    }).success,
    false,
  );
  assert.equal(
    contactMessageSchema.safeParse({
      name: "Noor",
      email: "noor@example.test",
      message: "a".repeat(4_001),
    }).success,
    false,
  );
});
