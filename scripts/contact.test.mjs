import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { createServer } from "vite";

let vite;
let getSql;
let storeContactMessage;
let listContactMessageRecords;
let setContactHandledRecord;

before(async () => {
  vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ storeContactMessage, listContactMessageRecords, setContactHandledRecord } =
    await vite.ssrLoadModule("/src/lib/server/contact.server.ts"));
});

after(async () => {
  await vite?.close();
});

test("contact stores a validated message and admin can mark it handled", async () => {
  const unique = randomUUID();
  const email = `CONTACT+${unique}@EXAMPLE.TEST`;
  await storeContactMessage(
    {
      idempotencyKey: randomUUID(),
      name: "  Noor de Vries ",
      email,
      message: "  Dit is een geldig contactbericht.  ",
    },
    `test-${unique}`,
  );

  const sql = await getSql();
  const stored = await sql.query(
    `select id, name, email, message, handled, handled_at
     from contact_messages where email = $1`,
    [email.toLowerCase()],
  );
  assert.equal(stored.length, 1);
  assert.equal(stored[0].name, "Noor de Vries");
  assert.equal(stored[0].message, "Dit is een geldig contactbericht.");
  assert.equal(stored[0].handled, false);
  assert.equal(stored[0].handled_at, null);

  const queuedMail = await sql.query(
    `select kind, recipient, reply_to, status, attempt_count
     from transactional_mail_outbox
     where dedupe_key like $1
     order by kind`,
    [`contact:${stored[0].id}:%`],
  );
  assert.deepEqual(
    queuedMail.map((mail) => ({
      kind: mail.kind,
      recipient: mail.recipient,
      reply_to: mail.reply_to,
      status: mail.status,
      attempt_count: mail.attempt_count,
    })),
    [
      {
        kind: "contact_customer",
        recipient: email.toLowerCase(),
        reply_to: "info@afslank-injecties.nl",
        status: "pending",
        attempt_count: 0,
      },
      {
        kind: "contact_owner",
        recipient: "info@afslank-injecties.nl",
        reply_to: email.toLowerCase(),
        status: "pending",
        attempt_count: 0,
      },
    ],
  );

  const open = await listContactMessageRecords({
    handled: false,
    page: 1,
    pageSize: 20,
  });
  assert.ok(open.messages.some((message) => message.id === stored[0].id));

  const updated = await setContactHandledRecord(stored[0].id, true);
  assert.equal(updated.handled, true);
  assert.ok(updated.handledAt);
});

test("contact creation uses the persistent abuse limit", async () => {
  const key = `contact-limit-${randomUUID()}`;
  for (let index = 0; index < 8; index += 1) {
    await storeContactMessage(
      {
        idempotencyKey: randomUUID(),
        name: "Noor de Vries",
        email: `contact-limit-${index}-${randomUUID()}@example.test`,
        message: "Dit is een geldig contactbericht.",
      },
      key,
    );
  }
  await assert.rejects(
    storeContactMessage(
      {
        idempotencyKey: randomUUID(),
        name: "Noor de Vries",
        email: `contact-limit-${randomUUID()}@example.test`,
        message: "Dit is een geldig contactbericht.",
      },
      key,
    ),
    (error) => error?.name === "RateLimitError" && error?.status === 429,
  );
});

test("identical concurrent contact retries create one record and one mail pair", async () => {
  const unique = randomUUID();
  const input = {
    idempotencyKey: randomUUID(),
    name: "Noor de Vries",
    email: `contact-idempotent-${unique}@example.test`,
    message: "Dit contactbericht wordt bewust gelijktijdig herhaald.",
  };

  const results = await Promise.all([
    storeContactMessage(input, `contact-idempotent-a-${unique}`),
    storeContactMessage(input, `contact-idempotent-b-${unique}`),
  ]);
  assert.equal(new Set(results.map((result) => result.id)).size, 1);
  assert.deepEqual(results.map((result) => result.replayed).sort(), [
    false,
    true,
  ]);

  const sql = await getSql();
  const stored = await sql.query(
    `select count(*)::int as count
     from contact_messages where idempotency_key = $1`,
    [input.idempotencyKey],
  );
  const queued = await sql.query(
    `select count(*)::int as count
     from transactional_mail_outbox where contact_message_id = $1`,
    [results[0].id],
  );
  assert.deepEqual(stored, [{ count: 1 }]);
  assert.deepEqual(queued, [{ count: 2 }]);

  await assert.rejects(
    storeContactMessage(
      { ...input, message: "Dezelfde sleutel mag geen andere inhoud krijgen." },
      `contact-idempotent-conflict-${unique}`,
    ),
    (error) =>
      error?.name === "ContactIdempotencyConflictError" &&
      error?.status === 409,
  );
});
