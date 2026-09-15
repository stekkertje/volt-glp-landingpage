import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { createServer } from "vite";

let vite;
let getSql;
let createOrderRecord;
let getAdminSummaryRecord;
let issueAddressValidationToken;

process.env.ADDRESS_VALIDATION_TOKEN_SECRET =
  "dashboard-address-validation-secret-with-at-least-32-characters";

function orderInput() {
  const unique = randomUUID();
  const input = {
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
  return {
    ...input,
    addressValidationToken: issueAddressValidationToken({
      address: input,
      provider: "apicheck",
    }),
  };
}

before(async () => {
  vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ issueAddressValidationToken } = await vite.ssrLoadModule(
    "/src/lib/server/address-validation-token.server.ts",
  ));
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

test("admin summary includes daily work and mail failures needing review", async () => {
  const pending = await createOrderRecord(orderInput(), { userId: null });
  await createOrderRecord(orderInput(), { userId: null });
  const paid = await createOrderRecord(orderInput(), { userId: null });
  const sql = await getSql();
  await sql.query("update orders set status = 'paid' where id = $1", [
    paid.order.id,
  ]);
  const openContactId = randomUUID();
  await sql.query(
    `insert into contact_messages (
      id, name, email, message, handled, created_at
    ) values
      ($1, 'Open', 'open@example.test', 'Open contactbericht', false, now()),
      ($2, 'Klaar', 'klaar@example.test', 'Afgehandeld bericht', true, now())`,
    [openContactId, randomUUID()],
  );
  const mailRows = await sql.query(
    `select id from transactional_mail_outbox where order_id = $1
     order by created_at, id
     limit 2`,
    [pending.order.id],
  );
  await sql.query(
    `update transactional_mail_outbox
     set status = 'failed', next_attempt_at = null,
         last_error = 'delivery_uncertain_after_worker_timeout'
     where id = $1`,
    [mailRows[0].id],
  );
  await sql.query(
    `update transactional_mail_outbox
     set status = 'failed', next_attempt_at = null, order_id = null,
         order_event_id = null, contact_message_id = $2,
         kind = 'contact_owner', recipient = 'private.recipient@example.test',
         last_error = 'smtp_econnection_421_conn'
     where id = $1`,
    [mailRows[1].id, openContactId],
  );

  const summary = await getAdminSummaryRecord();
  assert.equal(summary.pendingOrders, 2);
  assert.equal(summary.processingOrders, 1);
  assert.equal(summary.openContacts, 1);
  assert.equal(summary.failedMails, 2);
  assert.equal(summary.uncertainMails, 1);
  assert.equal(summary.mailFailures.length, 2);

  const uncertain = summary.mailFailures.find((mail) => mail.deliveryUncertain);
  assert.equal(uncertain.reference, `Bestelling ${pending.order.orderNumber}`);
  assert.match(uncertain.recipient, /^[^@]*\*{3}@[^@]*\*{3}\./);
  assert.ok(Number.isFinite(Date.parse(uncertain.failedAt)));

  const contact = summary.mailFailures.find(
    (mail) => mail.kind === "contact_owner",
  );
  assert.equal(contact.reference, `Contactbericht ${openContactId.slice(-8)}`);
  assert.equal(contact.recipient, "p***@e***.test");
  assert.equal(contact.deliveryUncertain, false);
  assert.equal("subject" in contact, false);
  assert.equal("textBody" in contact, false);
  assert.equal("htmlBody" in contact, false);
  assert.equal("lastError" in contact, false);
  assert.deepEqual(
    {
      pendingOrders: summary.pendingOrders,
      processingOrders: summary.processingOrders,
      openContacts: summary.openContacts,
      failedMails: summary.failedMails,
      uncertainMails: summary.uncertainMails,
    },
    {
      pendingOrders: 2,
      processingOrders: 1,
      openContacts: 1,
      failedMails: 2,
      uncertainMails: 1,
    },
  );
});
