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
    `select idempotency_payload_hash, idempotency_viewer_hash
     from orders
     where id = $1`,
    [result.order.id],
  );
  const accessTokens = await sql.query(
    `select token_hash, token_ciphertext, issued_at, expires_at
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
  assert.equal(result.order.orderNumber, "MED-3100");
  assert.equal("guestAccessTokenHash" in result.order, false);
  assert.ok(result.guestAccessToken.length >= 20);
  assert.match(security[0].idempotency_payload_hash, /^[a-f0-9]{64}$/);
  assert.match(security[0].idempotency_viewer_hash, /^[a-f0-9]{64}$/);
  assert.equal(accessTokens.length, 1);
  assert.match(accessTokens[0].token_hash, /^[a-f0-9]{64}$/);
  assert.match(accessTokens[0].token_ciphertext, /^v1\.[^.]+\.[^.]+\.[^.]+$/);
  assert.equal(
    accessTokens[0].token_ciphertext.includes(
      result.guestAccessToken.replaceAll("-", ""),
    ),
    false,
  );
  assert.equal(
    new Date(accessTokens[0].expires_at).getTime() -
      new Date(accessTokens[0].issued_at).getTime(),
    72 * 60 * 60 * 1_000,
  );
});

test("an idempotent retry returns the same guest proof without minting another", async () => {
  const input = orderInput();
  const first = await createOrderRecord(input, { userId: null });
  const second = await createOrderRecord(input, { userId: null });

  assert.equal(first.order.orderNumber, "MED-3102");
  assert.equal(second.order.id, first.order.id);
  assert.equal(second.order.orderNumber, first.order.orderNumber);
  assert.equal(second.guestAccessToken, first.guestAccessToken);
  assert.equal(second.replayed, true);

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
  const tokens = await sql.query(
    `select token_hash from order_access_tokens where order_id = $1 order by issued_at`,
    [first.order.id],
  );
  assert.equal(tokens.length, 1);
  assert.ok(tokens.every((row) => /^[a-f0-9]{64}$/.test(row.token_hash)));
  assert.ok(tokens.every((row) => row.token_hash !== first.guestAccessToken));
});

test("a replay collapses multiple active proofs to one", async () => {
  const input = orderInput();
  const created = await createOrderRecord(input, { userId: null });
  const sql = await getSql();
  await sql.query(
    `insert into order_access_tokens (
      id, order_id, token_hash, token_ciphertext, issued_at, expires_at, revoked_at
    )
    select $1, order_id, $2, null, issued_at - interval '1 minute', expires_at, null
    from order_access_tokens
    where order_id = $3 and revoked_at is null`,
    [randomUUID(), "f".repeat(64), created.order.id],
  );

  const replay = await createOrderRecord(input, { userId: null });
  assert.equal(replay.guestAccessToken, created.guestAccessToken);
  const active = await sql.query(
    `select token_hash
     from order_access_tokens
     where order_id = $1 and revoked_at is null and expires_at > now()`,
    [created.order.id],
  );
  assert.equal(active.length, 1);
});

test("concurrent legacy-token retries share one replacement proof", async () => {
  const input = orderInput();
  const created = await createOrderRecord(input, { userId: null });
  const sql = await getSql();
  await sql.query(
    "update order_access_tokens set token_ciphertext = null where order_id = $1",
    [created.order.id],
  );
  const before = await sql.query(
    "select expires_at from order_access_tokens where order_id = $1 and revoked_at is null",
    [created.order.id],
  );

  const [firstReplay, secondReplay] = await Promise.all([
    createOrderRecord(input, { userId: null }),
    createOrderRecord(input, { userId: null }),
  ]);

  assert.equal(firstReplay.guestAccessToken, secondReplay.guestAccessToken);
  assert.notEqual(firstReplay.guestAccessToken, created.guestAccessToken);
  const activeTokens = await sql.query(
    `select expires_at
     from order_access_tokens
     where order_id = $1 and revoked_at is null and expires_at > now()`,
    [created.order.id],
  );
  assert.equal(activeTokens.length, 1);
  assert.equal(
    new Date(activeTokens[0].expires_at).getTime(),
    new Date(before[0].expires_at).getTime(),
  );
});

test("an expired idempotent replay never mints a fresh recovery window", async () => {
  const input = orderInput();
  const created = await createOrderRecord(input, { userId: null });
  const sql = await getSql();
  await sql.query(
    `update order_access_tokens
     set issued_at = now() - interval '73 hours',
         expires_at = now() - interval '1 hour'
     where order_id = $1`,
    [created.order.id],
  );

  await assert.rejects(
    createOrderRecord(input, { userId: null }),
    /toegang.*verlopen|verlopen/i,
  );
  const tokens = await sql.query(
    `select expires_at, revoked_at
     from order_access_tokens
     where order_id = $1`,
    [created.order.id],
  );
  assert.equal(tokens.length, 1);
  assert.ok(new Date(tokens[0].expires_at).getTime() < Date.now());
  assert.equal(tokens[0].revoked_at, null);
});

test("key rotation rewraps ciphertext without changing or revoking the proof", async () => {
  const previousCurrent = process.env.ORDER_ACCESS_TOKEN_SECRET;
  const previousKeyring = process.env.ORDER_ACCESS_TOKEN_PREVIOUS_SECRETS;
  const oldSecret = `oud-${"a".repeat(40)}`;
  const newSecret = `nieuw-${"b".repeat(40)}`;
  try {
    process.env.ORDER_ACCESS_TOKEN_SECRET = oldSecret;
    delete process.env.ORDER_ACCESS_TOKEN_PREVIOUS_SECRETS;
    const input = orderInput();
    const created = await createOrderRecord(input, { userId: null });
    const sql = await getSql();
    const before = await sql.query(
      `select token_ciphertext, expires_at
       from order_access_tokens
       where order_id = $1 and revoked_at is null`,
      [created.order.id],
    );

    process.env.ORDER_ACCESS_TOKEN_SECRET = newSecret;
    process.env.ORDER_ACCESS_TOKEN_PREVIOUS_SECRETS = oldSecret;
    const replay = await createOrderRecord(input, { userId: null });

    assert.equal(replay.guestAccessToken, created.guestAccessToken);
    const after = await sql.query(
      `select token_ciphertext, expires_at, revoked_at
       from order_access_tokens
       where order_id = $1`,
      [created.order.id],
    );
    assert.equal(after.length, 1);
    assert.notEqual(after[0].token_ciphertext, before[0].token_ciphertext);
    assert.equal(
      new Date(after[0].expires_at).getTime(),
      new Date(before[0].expires_at).getTime(),
    );
    assert.equal(after[0].revoked_at, null);
  } finally {
    if (previousCurrent === undefined) {
      delete process.env.ORDER_ACCESS_TOKEN_SECRET;
    } else {
      process.env.ORDER_ACCESS_TOKEN_SECRET = previousCurrent;
    }
    if (previousKeyring === undefined) {
      delete process.env.ORDER_ACCESS_TOKEN_PREVIOUS_SECRETS;
    } else {
      process.env.ORDER_ACCESS_TOKEN_PREVIOUS_SECRETS = previousKeyring;
    }
  }
});

test("an unreadable active ciphertext fails without revoking its valid hash", async () => {
  const previousCurrent = process.env.ORDER_ACCESS_TOKEN_SECRET;
  const previousKeyring = process.env.ORDER_ACCESS_TOKEN_PREVIOUS_SECRETS;
  try {
    process.env.ORDER_ACCESS_TOKEN_SECRET = `eerste-${"c".repeat(40)}`;
    delete process.env.ORDER_ACCESS_TOKEN_PREVIOUS_SECRETS;
    const input = orderInput();
    const created = await createOrderRecord(input, { userId: null });

    process.env.ORDER_ACCESS_TOKEN_SECRET = `tweede-${"d".repeat(40)}`;
    await assert.rejects(
      createOrderRecord(input, { userId: null }),
      /niet veilig opnieuw|beheerder/i,
    );

    const stillAccessible = await getOrderRecordForViewer({
      id: created.order.id,
      accessCode: created.guestAccessToken,
      userId: null,
      isAdmin: false,
    });
    assert.equal(stillAccessible.id, created.order.id);
    const sql = await getSql();
    const tokens = await sql.query(
      "select revoked_at from order_access_tokens where order_id = $1",
      [created.order.id],
    );
    assert.deepEqual(tokens, [{ revoked_at: null }]);
  } finally {
    if (previousCurrent === undefined) {
      delete process.env.ORDER_ACCESS_TOKEN_SECRET;
    } else {
      process.env.ORDER_ACCESS_TOKEN_SECRET = previousCurrent;
    }
    if (previousKeyring === undefined) {
      delete process.env.ORDER_ACCESS_TOKEN_PREVIOUS_SECRETS;
    } else {
      process.env.ORDER_ACCESS_TOKEN_PREVIOUS_SECRETS = previousKeyring;
    }
  }
});

test("a persistent database uses the stable auth secret fallback and rotates to an explicit order secret", async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousCurrent = process.env.ORDER_ACCESS_TOKEN_SECRET;
  const previousAuth = process.env.BETTER_AUTH_SECRET;
  try {
    process.env.DATABASE_URL = "postgres://configured.example/volt";
    delete process.env.ORDER_ACCESS_TOKEN_SECRET;
    process.env.BETTER_AUTH_SECRET = `auth-${"e".repeat(40)}`;
    const input = orderInput();
    const created = await createOrderRecord(input, { userId: null });
    const sql = await getSql();
    const before = await sql.query(
      "select token_ciphertext from order_access_tokens where order_id = $1",
      [created.order.id],
    );

    process.env.ORDER_ACCESS_TOKEN_SECRET = `order-${"f".repeat(40)}`;
    const replay = await createOrderRecord(input, { userId: null });
    const after = await sql.query(
      "select token_ciphertext, revoked_at from order_access_tokens where order_id = $1",
      [created.order.id],
    );
    assert.equal(replay.guestAccessToken, created.guestAccessToken);
    assert.notEqual(after[0].token_ciphertext, before[0].token_ciphertext);
    assert.equal(after[0].revoked_at, null);
  } finally {
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
    if (previousCurrent === undefined) {
      delete process.env.ORDER_ACCESS_TOKEN_SECRET;
    } else {
      process.env.ORDER_ACCESS_TOKEN_SECRET = previousCurrent;
    }
    if (previousAuth === undefined) {
      delete process.env.BETTER_AUTH_SECRET;
    } else {
      process.env.BETTER_AUTH_SECRET = previousAuth;
    }
  }
});

test("a persistent database fails closed without either stable secret", async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousCurrent = process.env.ORDER_ACCESS_TOKEN_SECRET;
  const previousAuth = process.env.BETTER_AUTH_SECRET;
  try {
    process.env.DATABASE_URL = "postgres://configured.example/volt";
    delete process.env.ORDER_ACCESS_TOKEN_SECRET;
    delete process.env.BETTER_AUTH_SECRET;
    await assert.rejects(
      createOrderRecord(orderInput(), { userId: null }),
      /ORDER_ACCESS_TOKEN_SECRET.*BETTER_AUTH_SECRET.*verplicht/i,
    );
    process.env.BETTER_AUTH_SECRET = "te-kort";
    await assert.rejects(
      createOrderRecord(orderInput(), { userId: null }),
      /BETTER_AUTH_SECRET.*minimaal 32/i,
    );
  } finally {
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
    if (previousCurrent === undefined) {
      delete process.env.ORDER_ACCESS_TOKEN_SECRET;
    } else {
      process.env.ORDER_ACCESS_TOKEN_SECRET = previousCurrent;
    }
    if (previousAuth === undefined) {
      delete process.env.BETTER_AUTH_SECRET;
    } else {
      process.env.BETTER_AUTH_SECRET = previousAuth;
    }
  }
});

test("canonical normalization treats equivalent retry payloads as identical", async () => {
  const input = orderInput({
    lines: [
      { slug: "semaglutide-2mg", optionId: "none", qty: 1 },
      { slug: "semaglutide-2mg", optionId: "none", qty: 1 },
    ],
  });
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
      lines: [{ slug: "semaglutide-2mg", optionId: "none", qty: 2 }],
    },
    { userId: null },
  );
  assert.equal(replay.replayed, true);
  assert.equal(replay.order.id, first.order.id);
});

test("concurrent identical retries create one order and return the same proof", async () => {
  const input = orderInput();
  const [first, second] = await Promise.all([
    createOrderRecord(input, { userId: null }),
    createOrderRecord(input, { userId: null }),
  ]);

  assert.equal(first.order.id, second.order.id);
  assert.equal(first.guestAccessToken, second.guestAccessToken);

  const order = await getOrderRecordForViewer({
    id: first.order.id,
    accessCode: second.guestAccessToken,
    userId: null,
    isAdmin: false,
  });
  assert.equal(order.id, first.order.id);

  const sql = await getSql();
  const counts = await sql.query(
    "select count(*)::int as count from orders where idempotency_key = $1",
    [input.idempotencyKey],
  );
  assert.deepEqual(counts, [{ count: 1 }]);
  const tokens = await sql.query(
    "select count(*)::int as count from order_access_tokens where order_id = $1",
    [first.order.id],
  );
  assert.deepEqual(tokens, [{ count: 1 }]);
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
      const allowed =
        ALLOWED_ORDER_STATUS_TRANSITIONS[current].includes(target);
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
