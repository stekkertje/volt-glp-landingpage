import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { splitPostgresStatements } from "./migration-sql.mjs";

let pg;

function pgliteMigrationSql(text) {
  return text
    .replace(/^-- migrate:no-transaction\s*/i, "")
    .replace(
      /\b(create(?:\s+unique)?|drop)\s+index\s+concurrently\b/gi,
      "$1 index",
    );
}

async function executeMigrationStatements(executor, text) {
  for (const statement of splitPostgresStatements(pgliteMigrationSql(text))) {
    await executor.exec(statement);
  }
}

before(async () => {
  pg = new PGlite();
  await pg.waitReady;
  const names = [
    "0001_auth.sql",
    "0002_shop.sql",
    "0003_order_security.sql",
    "0004_order_user_fk.sql",
    "0005_orders_user_index.sql",
    "0006_validate_order_user_fk.sql",
  ];
  for (const name of names) {
    const text = await readFile(
      new URL(`../migrations/${name}`, import.meta.url),
      "utf8",
    );
    await executeMigrationStatements(pg, text);
  }
});

after(async () => {
  await pg?.close();
});

test("0007 fails closed on historical duplicate variants and is retry-safe", async () => {
  const orderId = randomUUID();
  await pg.query(
    `insert into orders (
      id, order_number, email, name, street, house_number, postcode, city,
      country, status, subtotal_cents, stack_discount_cents,
      code_discount_cents, shipping_cents, total_cents
    ) values ($1, $2, $3, 'Historische order', 'Teststraat', '1', '1234 AB',
      'Utrecht', 'NL', 'pending', 17000, 0, 0, 0, 17000)`,
    [
      orderId,
      `VOLT-${randomUUID().slice(0, 8).toUpperCase()}`,
      `${orderId}@example.test`,
    ],
  );
  for (let index = 0; index < 2; index += 1) {
    await pg.query(
      `insert into order_lines (
        id, order_id, slug, option_id, name, option_label,
        unit_price_cents, qty, line_total_cents
      ) values ($1, $2, 'semaglutide-2mg', 'none', 'Semaglutide 2mg',
        'Geen extra''s', 8500, 1, 8500)`,
      [randomUUID(), orderId],
    );
  }

  const migration = await readFile(
    new URL("../migrations/0007_review_hardening.sql", import.meta.url),
    "utf8",
  );
  await assert.rejects(
    pg.transaction((tx) => executeMigrationStatements(tx, migration)),
    /migration_0007_duplicate_order_variants_must_be_resolved|check constraint/i,
  );
  const untouched = await pg.query(
    "select id from order_lines where order_id = $1 order by id",
    [orderId],
  );
  assert.equal(untouched.rows.length, 2);

  // The fixture is repaired explicitly to prove the migration itself never
  // mutates history, then the exact same migration is retried.
  await pg.query("delete from order_lines where id = $1", [
    untouched.rows[0].id,
  ]);
  await pg.transaction((tx) => executeMigrationStatements(tx, migration));

  const indexes = await pg.query(
    `select index_meta.indisvalid
     from pg_index as index_meta
     join pg_class as index_class on index_class.oid = index_meta.indexrelid
     where index_class.relname = 'order_lines_order_variant_uidx'`,
  );
  assert.deepEqual(indexes.rows, [{ indisvalid: true }]);
  await assert.rejects(
    pg.query(
      `insert into order_lines (
        id, order_id, slug, option_id, name, option_label,
        unit_price_cents, qty, line_total_cents
      ) values ($1, $2, 'semaglutide-2mg', 'none', 'Semaglutide 2mg',
        'Geen extra''s', 8500, 1, 8500)`,
      [randomUUID(), orderId],
    ),
    /unique|duplicate|order_lines_order_variant/i,
  );
});

test("the production parser ignores semicolons outside SQL delimiters", () => {
  const statements = splitPostgresStatements(`
    -- uitleg met ; zonder nieuw statement
    select 'waarde;met;puntkomma' as waarde;
    /* blokcommentaar ; met /* genest ; commentaar */ nog steeds commentaar */
    select "identifier;met;puntkomma" from voorbeeld;
    do $migration$
    begin
      perform 'body;waarde';
      perform 2;
    end;
    $migration$;
    -- afsluitend commentaar ; is geen leeg statement
  `);

  assert.equal(statements.length, 3);
  assert.match(statements[0], /select 'waarde;met;puntkomma'/);
  assert.match(statements[1], /select "identifier;met;puntkomma"/);
  assert.match(statements[2], /perform 'body;waarde';\s*perform 2;/);
});
