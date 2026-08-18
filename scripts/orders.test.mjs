import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { createServer } from "vite";

let vite;
let getSql;
let createOrderRecord;
let getOrderRecordForViewer;
let updateOrderStatusRecord;

function orderInput(overrides = {}) {
  const unique = randomUUID();
  return {
    name: "  Noor de Vries ",
    email: `NOOR+${unique}@EXAMPLE.TEST`,
    phone: " 0612345678 ",
    street: " Teststraat ",
    houseNumber: " 12 A ",
    postcode: "1234ab",
    city: " Utrecht ",
    country: "nl",
    note: "  Bel aan bij de buren. ",
    lines: [{ slug: "semaglutide-2mg", optionId: "none", qty: 1 }],
    discountCode: null,
    idempotencyKey: randomUUID(),
    ...overrides,
  };
}

before(async () => {
  vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({
    createOrderRecord,
    getOrderRecordForViewer,
    updateOrderStatusRecord,
  } = await vite.ssrLoadModule("/src/lib/server/orders.server.ts"));
});

after(async () => {
  await vite?.close();
});

test("createOrder writes customer, order and lines using server prices", async () => {
  const input = orderInput();
  const result = await createOrderRecord(input, { userId: null });
  const sql = await getSql();

  const customers = await sql.query(
    "select email, name, phone from customers where email = $1",
    [input.email.toLowerCase()],
  );
  const orders = await sql.query(
    `select email, name, postcode, country, subtotal_cents, shipping_cents, total_cents
     from orders where id = $1`,
    [result.order.id],
  );
  const lines = await sql.query(
    `select slug, option_id, name, option_label, unit_price_cents, qty, line_total_cents
     from order_lines where order_id = $1`,
    [result.order.id],
  );

  assert.deepEqual(customers, [
    {
      email: input.email.toLowerCase(),
      name: "Noor de Vries",
      phone: "0612345678",
    },
  ]);
  assert.deepEqual(orders, [
    {
      email: input.email.toLowerCase(),
      name: "Noor de Vries",
      postcode: "1234 AB",
      country: "NL",
      subtotal_cents: 8500,
      shipping_cents: 495,
      total_cents: 8995,
    },
  ]);
  assert.deepEqual(lines, [
    {
      slug: "semaglutide-2mg",
      option_id: "none",
      name: "Semaglutide 2mg",
      option_label: "Geen extra's",
      unit_price_cents: 8500,
      qty: 1,
      line_total_cents: 8500,
    },
  ]);
  assert.match(result.order.orderNumber, /^VOLT-[A-Z0-9]{8}$/);
  assert.equal("guestAccessTokenHash" in result.order, false);
  assert.ok(result.guestAccessToken.length >= 20);
});

test("an idempotent retry rotates guest access without creating another order", async () => {
  const input = orderInput();
  const first = await createOrderRecord(input, { userId: null });
  const second = await createOrderRecord(input, { userId: null });

  assert.equal(second.order.id, first.order.id);
  assert.equal(second.order.orderNumber, first.order.orderNumber);
  assert.notEqual(second.guestAccessToken, first.guestAccessToken);
  assert.equal(second.replayed, true);

  await assert.rejects(
    getOrderRecordForViewer({
      id: first.order.id,
      accessCode: first.guestAccessToken,
      userId: null,
      isAdmin: false,
    }),
    /niet gevonden|toegankelijk/i,
  );
  const accessible = await getOrderRecordForViewer({
    id: first.order.id,
    accessCode: second.guestAccessToken,
    userId: null,
    isAdmin: false,
  });
  assert.equal(accessible.id, first.order.id);

  const sql = await getSql();
  const orderCount = await sql.query(
    "select count(*)::int as count from orders where idempotency_key = $1",
    [input.idempotencyKey],
  );
  const customerCount = await sql.query(
    "select count(*)::int as count from customers where email = $1",
    [input.email.toLowerCase()],
  );
  assert.deepEqual(orderCount, [{ count: 1 }]);
  assert.deepEqual(customerCount, [{ count: 1 }]);
});

test("an order is not returned without viewer authorization", async () => {
  const created = await createOrderRecord(orderInput(), { userId: null });

  await assert.rejects(
    getOrderRecordForViewer({
      id: created.order.id,
      userId: null,
      isAdmin: false,
    }),
    /niet gevonden|toegankelijk/i,
  );
});

test("order number and email alone do not authorize a guest", async () => {
  const input = orderInput();
  const created = await createOrderRecord(input, { userId: null });

  await assert.rejects(
    getOrderRecordForViewer({
      orderNumber: created.order.orderNumber,
      email: input.email,
      userId: null,
      isAdmin: false,
    }),
    /niet gevonden|toegankelijk/i,
  );
});

test("a wrong recovery code does not expose an order", async () => {
  const created = await createOrderRecord(orderInput(), { userId: null });

  await assert.rejects(
    getOrderRecordForViewer({
      id: created.order.id,
      accessCode: "VERKEERDE-HERSTELCODE",
      userId: null,
      isAdmin: false,
    }),
    /niet gevonden|toegankelijk/i,
  );
});

test("admin status updates accept only known order statuses", async () => {
  const created = await createOrderRecord(orderInput(), { userId: null });
  const updated = await updateOrderStatusRecord(created.order.id, "paid");
  assert.equal(updated.status, "paid");

  await assert.rejects(
    updateOrderStatusRecord(created.order.id, "onbekend"),
    /ongeldige bestelstatus/i,
  );
});
