import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { createServer } from "vite";

let vite;
let getSql;
let withSqlTransaction;
let signAdminSession;
let verifyAdminSession;

before(async () => {
  vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ getSql, withSqlTransaction } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ signAdminSession, verifyAdminSession } = await vite.ssrLoadModule(
    "/src/lib/server/admin-session.server.ts",
  ));
});

after(async () => {
  await vite?.close();
});

test("the shop migration creates all tables and seeds VOLT10", async () => {
  const sql = await getSql();
  const tables = await sql.query(
    `select table_name
     from information_schema.tables
     where table_schema = 'public'
       and table_name = any($1)
     order by table_name`,
    [
      [
        "contact_messages",
        "customers",
        "discount_codes",
        "order_access_tokens",
        "order_claim_tokens",
        "order_events",
        "order_fulfillment_lines",
        "order_lines",
        "order_shipments",
        "orders",
        "rate_limit_buckets",
        "transactional_mail_outbox",
      ],
    ],
  );
  assert.deepEqual(
    tables.map((row) => row.table_name),
    [
      "contact_messages",
      "customers",
      "discount_codes",
      "order_access_tokens",
      "order_claim_tokens",
      "order_events",
      "order_fulfillment_lines",
      "order_lines",
      "order_shipments",
      "orders",
      "rate_limit_buckets",
      "transactional_mail_outbox",
    ],
  );

  const codes =
    await sql`select code, percent, active from discount_codes where code = 'VOLT10'`;
  assert.deepEqual(codes, [{ code: "VOLT10", percent: 10, active: true }]);
  const foreignKeys = await sql.query(
    "select conname from pg_constraint where conname = 'orders_user_id_fkey'",
  );
  assert.deepEqual(foreignKeys, [{ conname: "orders_user_id_fkey" }]);
  const indexes = await sql.query(
    `select index_class.relname as indexname, index_meta.indisvalid
     from pg_index as index_meta
     join pg_class as index_class on index_class.oid = index_meta.indexrelid
     where index_class.relname = any($1)
     order by index_class.relname`,
    [["order_lines_order_variant_uidx", "orders_user_id_idx"]],
  );
  assert.deepEqual(indexes, [
    { indexname: "order_lines_order_variant_uidx", indisvalid: true },
    { indexname: "orders_user_id_idx", indisvalid: true },
  ]);

  const legacyColumns = await sql.query(
    `select column_name
     from information_schema.columns
     where table_schema = 'public'
       and table_name = 'orders'
       and column_name = 'guest_access_token_hash'`,
  );
  assert.deepEqual(legacyColumns, []);
  const tokenColumns = await sql.query(
    `select column_name
     from information_schema.columns
     where table_schema = 'public'
       and table_name = 'order_access_tokens'
       and column_name = 'token_ciphertext'`,
  );
  assert.deepEqual(tokenColumns, [{ column_name: "token_ciphertext" }]);

  const addressValidationColumns = await sql.query(
    `select column_name
     from information_schema.columns
     where table_schema = 'public'
       and table_name = 'orders'
       and column_name = any($1)
     order by column_name`,
    [
      [
        "address_validated_at",
        "address_validation_fingerprint",
        "address_validation_provider",
        "address_validation_status",
      ],
    ],
  );
  assert.deepEqual(
    addressValidationColumns.map((row) => row.column_name),
    [
      "address_validated_at",
      "address_validation_fingerprint",
      "address_validation_provider",
      "address_validation_status",
    ],
  );
});

test("the database rejects duplicate variants within one order", async () => {
  const orderId = randomUUID();
  await assert.rejects(
    withSqlTransaction(async (tx) => {
      await tx.query(
        `insert into orders (
          id, order_number, email, name, street, house_number, postcode, city, country,
          status, subtotal_cents, stack_discount_cents, code_discount_cents,
          shipping_cents, total_cents
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0, 0, 0, $11)`,
        [
          orderId,
          `VOLT-${randomUUID().slice(0, 8).toUpperCase()}`,
          `${orderId}@example.test`,
          "Unieke variant",
          "Teststraat",
          "1",
          "1234 AB",
          "Utrecht",
          "NL",
          "pending",
          17_000,
        ],
      );
      for (let index = 0; index < 2; index += 1) {
        await tx.query(
          `insert into order_lines (
            id, order_id, slug, option_id, name, option_label,
            unit_price_cents, qty, line_total_cents
          ) values ($1, $2, 'semaglutide-2mg', 'none', 'Semaglutide 2mg',
            'Geen extra''s', 8500, 1, 8500)`,
          [randomUUID(), orderId],
        );
      }
    }),
    /unique|duplicate|order_lines_order_variant/i,
  );

  const sql = await getSql();
  assert.deepEqual(
    await sql.query("select id from orders where id = $1", [orderId]),
    [],
  );
});

test("withSqlTransaction rolls an order back when its line insert fails", async () => {
  const orderId = randomUUID();

  await assert.rejects(
    withSqlTransaction(async (tx) => {
      await tx.query(
        `insert into orders (
          id, order_number, email, name, street, house_number, postcode, city, country,
          status, subtotal_cents, stack_discount_cents, code_discount_cents,
          shipping_cents, total_cents
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0, 0, 495, $12)`,
        [
          orderId,
          `VOLT-${randomUUID().slice(0, 8).toUpperCase()}`,
          `${orderId}@example.test`,
          "Transactietest",
          "Teststraat",
          "1",
          "1234 AB",
          "Utrecht",
          "NL",
          "pending",
          8500,
          8995,
        ],
      );
      await tx.query(
        `insert into order_lines (
          id, order_id, slug, option_id, name, option_label,
          unit_price_cents, qty, line_total_cents
        ) values ($1, $2, 'semaglutide-2mg', 'none', 'Semaglutide 2mg',
          'Geen extra''s', 8500, 0, 0)`,
        [randomUUID(), orderId],
      );
    }),
  );

  const sql = await getSql();
  const rows = await sql`select id from orders where id = ${orderId}`;
  assert.equal(rows.length, 0);
});

test("an admin cookie signed with ADMIN_PASSWORD is invalid for the session secret", () => {
  const password = "alleen-voor-wachtwoordcontrole";
  const sessionSecret = "aparte-lange-sessie-signing-secret";
  const expiresAt = Date.now() + 60_000;

  const wrongCookie = signAdminSession(password, expiresAt);
  const validCookie = signAdminSession(sessionSecret, expiresAt);

  assert.equal(verifyAdminSession(wrongCookie, sessionSecret), false);
  assert.equal(verifyAdminSession(validCookie, sessionSecret), true);
});
