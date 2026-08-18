import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { createServer } from "vite";

let vite;
let getSql;
let createOrderRecord;
let getOrderRecordForViewer;
let listAdminOrderRecords;
let listOwnOrderRecords;
let updateOrderStatusRecord;
let ORDER_STATUSES;
let ALLOWED_ORDER_STATUS_TRANSITIONS;

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

async function insertAuthUser(id) {
  const sql = await getSql();
  await sql.query(
    `insert into "user" (
      "id", "name", "email", "emailVerified", "createdAt", "updatedAt"
    ) values ($1, $2, $3, true, now(), now())
    on conflict ("id") do nothing`,
    [id, `Gebruiker ${id}`, `${id}@example.test`],
  );
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
    listAdminOrderRecords,
    listOwnOrderRecords,
    updateOrderStatusRecord,
  } = await vite.ssrLoadModule("/src/lib/server/orders.server.ts"));
  ({ ORDER_STATUSES, ALLOWED_ORDER_STATUS_TRANSITIONS } =
    await vite.ssrLoadModule("/src/lib/order-status.ts"));
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
  const security = await sql.query(
    `select idempotency_payload_hash, idempotency_viewer_hash,
       guest_access_token_hash
     from orders
     where id = $1`,
    [result.order.id],
  );
  const accessTokens = await sql.query(
    `select token_hash, issued_at, expires_at
     from order_access_tokens
     where order_id = $1`,
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
  assert.match(security[0].idempotency_payload_hash, /^[a-f0-9]{64}$/);
  assert.match(security[0].idempotency_viewer_hash, /^[a-f0-9]{64}$/);
  assert.equal(security[0].guest_access_token_hash, null);
  assert.equal(accessTokens.length, 1);
  assert.match(accessTokens[0].token_hash, /^[a-f0-9]{64}$/);
  assert.equal(
    new Date(accessTokens[0].expires_at).getTime() -
      new Date(accessTokens[0].issued_at).getTime(),
    72 * 60 * 60 * 1_000,
  );
});

test("an idempotent retry keeps every issued guest proof valid", async () => {
  const input = orderInput();
  const first = await createOrderRecord(input, { userId: null });
  const second = await createOrderRecord(input, { userId: null });

  assert.equal(second.order.id, first.order.id);
  assert.equal(second.order.orderNumber, first.order.orderNumber);
  assert.notEqual(second.guestAccessToken, first.guestAccessToken);
  assert.equal(second.replayed, true);

  for (const accessCode of [
    first.guestAccessToken,
    second.guestAccessToken,
  ]) {
    const accessible = await getOrderRecordForViewer({
      id: first.order.id,
      accessCode,
      userId: null,
      isAdmin: false,
    });
    assert.equal(accessible.id, first.order.id);
  }

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
  const tokens = await sql.query(
    `select token_hash from order_access_tokens where order_id = $1 order by issued_at`,
    [first.order.id],
  );
  assert.equal(tokens.length, 2);
  assert.ok(tokens.every((row) => /^[a-f0-9]{64}$/.test(row.token_hash)));
  assert.ok(
    tokens.every(
      (row) =>
        row.token_hash !== first.guestAccessToken &&
        row.token_hash !== second.guestAccessToken,
    ),
  );
});

test("canonical normalization treats equivalent retry payloads as identical", async () => {
  const input = orderInput();
  const first = await createOrderRecord(input, { userId: null });
  const replay = await createOrderRecord(
    {
      ...input,
      name: "Noor de Vries",
      email: input.email.toLowerCase(),
      phone: "0612345678",
      street: "Teststraat",
      houseNumber: "12 A",
      postcode: "1234 AB",
      city: "Utrecht",
      country: "NL",
      note: "Bel aan bij de buren.",
      lines: [...input.lines].reverse(),
    },
    { userId: null },
  );
  assert.equal(replay.replayed, true);
  assert.equal(replay.order.id, first.order.id);
});

test("concurrent identical retries create one order and keep both proofs valid", async () => {
  const input = orderInput();
  const [first, second] = await Promise.all([
    createOrderRecord(input, { userId: null }),
    createOrderRecord(input, { userId: null }),
  ]);

  assert.equal(first.order.id, second.order.id);
  assert.notEqual(first.guestAccessToken, second.guestAccessToken);

  for (const accessCode of [
    first.guestAccessToken,
    second.guestAccessToken,
  ]) {
    const order = await getOrderRecordForViewer({
      id: first.order.id,
      accessCode,
      userId: null,
      isAdmin: false,
    });
    assert.equal(order.id, first.order.id);
  }

  const sql = await getSql();
  const counts = await sql.query(
    "select count(*)::int as count from orders where idempotency_key = $1",
    [input.idempotencyKey],
  );
  assert.deepEqual(counts, [{ count: 1 }]);
});

test("an idempotency key rejects a different canonical payload", async () => {
  const input = orderInput();
  await createOrderRecord(input, { userId: null });

  await assert.rejects(
    createOrderRecord(
      {
        ...input,
        name: "Andere Klant",
        email: `anders-${randomUUID()}@example.test`,
        street: "Andere straat",
      },
      { userId: null },
    ),
    /herhaalcode|idempotent|andere bestelling/i,
  );
});

test("an idempotency key rejects a different authenticated viewer", async () => {
  const input = orderInput();
  const firstUser = `user-${randomUUID()}`;
  const secondUser = `user-${randomUUID()}`;
  await insertAuthUser(firstUser);
  await insertAuthUser(secondUser);
  await createOrderRecord(input, { userId: firstUser });

  await assert.rejects(
    createOrderRecord(input, { userId: secondUser }),
    /herhaalcode|idempotent|andere bestelling/i,
  );
});

test("orders enforce the auth-user foreign key and list only the owner", async () => {
  const ownerId = `owner-${randomUUID()}`;
  const otherId = `owner-${randomUUID()}`;
  await insertAuthUser(ownerId);
  await insertAuthUser(otherId);

  const own = await createOrderRecord(orderInput(), { userId: ownerId });
  await createOrderRecord(orderInput(), { userId: otherId });
  const listed = await listOwnOrderRecords(ownerId);
  assert.deepEqual(
    listed.map((order) => order.id),
    [own.order.id],
  );

  await assert.rejects(
    createOrderRecord(orderInput(), {
      userId: `missing-${randomUUID()}`,
    }),
    /foreign key|orders_user_id/i,
  );
});

test("admin order pagination returns distinct working pages", async () => {
  const marker = `Pager ${randomUUID()}`;
  const created = await Promise.all([
    createOrderRecord(orderInput({ name: marker }), { userId: null }),
    createOrderRecord(orderInput({ name: marker }), { userId: null }),
    createOrderRecord(orderInput({ name: marker }), { userId: null }),
  ]);
  const first = await listAdminOrderRecords({
    search: marker,
    page: 1,
    pageSize: 2,
    status: "all",
  });
  const second = await listAdminOrderRecords({
    search: marker,
    page: 2,
    pageSize: 2,
    status: "all",
  });
  assert.equal(first.pageCount >= 2, true);
  assert.equal(first.orders.length, 2);
  assert.ok(second.orders.length >= 1);
  const ids = new Set([
    ...first.orders.map((order) => order.id),
    ...second.orders.map((order) => order.id),
  ]);
  for (const order of created) assert.ok(ids.has(order.order.id));
});

test("expired recovery codes and cookies do not authorize an order", async () => {
  const created = await createOrderRecord(orderInput(), { userId: null });
  const sql = await getSql();
  await sql.query(
    `update order_access_tokens
     set issued_at = now() - interval '73 hours',
         expires_at = now() - interval '1 hour'
     where order_id = $1`,
    [created.order.id],
  );

  await assert.rejects(
    getOrderRecordForViewer({
      id: created.order.id,
      accessCode: created.guestAccessToken,
      userId: null,
      isAdmin: false,
    }),
    /niet gevonden|toegankelijk/i,
  );
  await assert.rejects(
    getOrderRecordForViewer({
      id: created.order.id,
      cookieOrderId: created.order.id,
      cookieAccessToken: created.guestAccessToken,
      userId: null,
      isAdmin: false,
    }),
    /niet gevonden|toegankelijk/i,
  );
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

test("the server enforces every allowed and forbidden order-status transition", async () => {
  const sql = await getSql();
  for (const current of ORDER_STATUSES) {
    for (const target of ORDER_STATUSES) {
      const created = await createOrderRecord(orderInput(), { userId: null });
      await sql.query("update orders set status = $1 where id = $2", [
        current,
        created.order.id,
      ]);
      const allowed = ALLOWED_ORDER_STATUS_TRANSITIONS[current].includes(target);
      if (allowed) {
        const updated = await updateOrderStatusRecord(
          created.order.id,
          current,
          target,
        );
        assert.equal(updated.status, target, `${current} -> ${target}`);
      } else {
        await assert.rejects(
          updateOrderStatusRecord(created.order.id, current, target),
          /status|overgang|gewijzigd/i,
          `${current} -> ${target}`,
        );
      }
    }
  }
});

test("concurrent status updates with the same expected state cannot both win", async () => {
  const created = await createOrderRecord(orderInput(), { userId: null });
  const outcomes = await Promise.allSettled([
    updateOrderStatusRecord(created.order.id, "pending", "paid"),
    updateOrderStatusRecord(created.order.id, "pending", "cancelled"),
  ]);

  assert.equal(
    outcomes.filter((outcome) => outcome.status === "fulfilled").length,
    1,
  );
  assert.equal(
    outcomes.filter((outcome) => outcome.status === "rejected").length,
    1,
  );

  const sql = await getSql();
  const rows = await sql.query("select status from orders where id = $1", [
    created.order.id,
  ]);
  assert.ok(["paid", "cancelled"].includes(rows[0].status));
});
