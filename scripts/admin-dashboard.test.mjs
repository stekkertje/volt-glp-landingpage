import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { createServer } from "vite";

let vite;
let getSql;
let createOrderRecord;
let getAdminSummaryRecord;

function orderInput() {
  const unique = randomUUID();
  return {
    name: "Dashboard Tester",
    email: `dashboard-${unique}@example.test`,
    phone: "",
    street: "Teststraat",
    houseNumber: "1",
    postcode: "1234 AB",
    city: "Utrecht",
    country: "NL",
    note: "",
    lines: [{ slug: "semaglutide-2mg", optionId: "none", qty: 1 }],
    discountCode: null,
    idempotencyKey: randomUUID(),
  };
}

before(async () => {
  vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ createOrderRecord } = await vite.ssrLoadModule(
    "/src/lib/server/orders.server.ts",
  ));
  ({ getAdminSummaryRecord } = await vite.ssrLoadModule(
    "/src/lib/server/admin-dashboard.server.ts",
  ));
});

after(async () => {
  await vite?.close();
});

test("admin summary returns only daily operational counts", async () => {
  await createOrderRecord(orderInput(), { userId: null });
  await createOrderRecord(orderInput(), { userId: null });
  const paid = await createOrderRecord(orderInput(), { userId: null });
  const sql = await getSql();
  await sql.query("update orders set status = 'paid' where id = $1", [
    paid.order.id,
  ]);
  await sql.query(
    `insert into contact_messages (
      id, name, email, message, handled, created_at
    ) values
      ($1, 'Open', 'open@example.test', 'Open contactbericht', false, now()),
      ($2, 'Klaar', 'klaar@example.test', 'Afgehandeld bericht', true, now())`,
    [randomUUID(), randomUUID()],
  );

  assert.deepEqual(await getAdminSummaryRecord(), {
    pendingOrders: 2,
    processingOrders: 1,
    openContacts: 1,
  });
});
