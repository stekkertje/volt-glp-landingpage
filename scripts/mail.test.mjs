import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { createServer } from "vite";

let vite;
let getSql;
let enqueueTransactionalMail;
let processMailOutbox;
let resolveMailConfiguration;
let contactOwnerMail;
let contactCustomerReceiptMail;
let orderCustomerConfirmationMail;
let orderOwnerConfirmationMail;
let orderStatusChangedMail;
let orderAddressChangedMail;
let orderProductsChangedMail;

const configuredEnvironment = {
  SMTP_USER: "info@example.test",
  SMTP_PASSWORD: "test-password-not-used",
  MAIL_OWNER_ADDRESS: "beheer@example.test",
};

before(async () => {
  vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ enqueueTransactionalMail } = await vite.ssrLoadModule(
    "/src/lib/server/mail/outbox.server.ts",
  ));
  ({ processMailOutbox } = await vite.ssrLoadModule(
    "/src/lib/server/mail/worker.server.ts",
  ));
  ({ resolveMailConfiguration } = await vite.ssrLoadModule(
    "/src/lib/server/mail/config.server.ts",
  ));
  ({
    contactOwnerMail,
    contactCustomerReceiptMail,
    orderCustomerConfirmationMail,
    orderOwnerConfirmationMail,
    orderStatusChangedMail,
    orderAddressChangedMail,
    orderProductsChangedMail,
  } = await vite.ssrLoadModule("/src/lib/server/mail/templates.ts"));
});

after(async () => {
  await vite?.close();
});

test("Hostinger SMTP configuration is complete or disabled, never partial", () => {
  assert.equal(resolveMailConfiguration({}), null);
  assert.throws(
    () => resolveMailConfiguration({ REQUIRE_MAIL: "1" }),
    /SMTP-configuratie is verplicht wanneer REQUIRE_MAIL=1/,
  );
  const configuration = resolveMailConfiguration(configuredEnvironment);
  assert.equal(configuration.host, "smtp.hostinger.com");
  assert.equal(configuration.port, 465);
  assert.equal(configuration.secure, true);
  assert.equal(configuration.fromAddress, "info@example.test");
  assert.equal(configuration.ownerAddress, "beheer@example.test");

  assert.throws(
    () => resolveMailConfiguration({ SMTP_USER: "info@example.test" }),
    /samen zijn ingesteld/,
  );
  assert.throws(
    () =>
      resolveMailConfiguration({
        ...configuredEnvironment,
        MAIL_FROM_NAME: "VOLT\r\nBcc: aanvaller@example.test",
      }),
    /MAIL_FROM_NAME is ongeldig/,
  );
});

test("contact templates are Dutch, escaped and promise 48 hours on workdays", () => {
  const owner = contactOwnerMail({
    name: "<Noor>",
    email: "noor@example.test",
    message: "Vraag <script>alert(1)</script>\nTweede regel",
  });
  const customer = contactCustomerReceiptMail({ name: "<Noor>" });

  assert.match(owner.textBody, /Nieuw contactbericht/);
  assert.doesNotMatch(owner.htmlBody, /<script>/);
  assert.match(owner.htmlBody, /&lt;script&gt;/);
  assert.match(customer.textBody, /binnen 48 uur op werkdagen/);
  assert.match(customer.htmlBody, /binnen 48 uur op werkdagen/);
  assert.doesNotMatch(customer.htmlBody, /Beste <Noor>/);
});

test("order templates escape customer data and preserve the paid amount", () => {
  const shared = {
    orderNumber: "MED-4000",
    name: "<Noor>",
    lines: [
      {
        name: "Semaglutide <script>",
        optionLabel: "4 mg & pen",
        qty: 2,
      },
    ],
    totalCents: 16900,
    address: {
      name: "<Noor>",
      street: "Test & Straat",
      houseNumber: "12 A",
      postcode: "1234 AB",
      city: "Utrecht",
      country: "NL",
    },
  };
  const customer = orderCustomerConfirmationMail(shared);
  const owner = orderOwnerConfirmationMail({
    ...shared,
    email: "noor@example.test",
    phone: "0612345678",
  });
  const status = orderStatusChangedMail({
    orderNumber: shared.orderNumber,
    name: shared.name,
    status: "shipped",
  });
  const address = orderAddressChangedMail({
    orderNumber: shared.orderNumber,
    name: shared.name,
    address: shared.address,
  });
  const products = orderProductsChangedMail({
    orderNumber: shared.orderNumber,
    name: shared.name,
    lines: shared.lines,
    paidTotalCents: shared.totalCents,
  });

  for (const mail of [customer, owner, status, address, products]) {
    assert.doesNotMatch(mail.htmlBody, /<script>/);
    assert.doesNotMatch(mail.htmlBody, /Beste <Noor>/);
  }
  assert.match(customer.textBody, /€\s*169,00/);
  assert.match(customer.textBody, /bedrag.*blijft leidend/i);
  assert.match(customer.textBody, /afslank-injecties\.nl\/registreren/);
  assert.match(customer.textBody, /veilige bevestigingslink/);
  assert.match(status.textBody, /Verzonden/);
  assert.match(address.textBody, /Test & Straat/);
  assert.match(products.textBody, /vastgelegde bedrag.*ongewijzigd/i);
});

test("outbox deduplicates and marks successful delivery", async () => {
  const unique = randomUUID();
  const draft = {
    dedupeKey: `test:${unique}:success`,
    kind: "contact_customer",
    to: "klant@example.test",
    subject: "Testbevestiging",
    textBody: "Dit is een testbericht.",
    htmlBody: "<p>Dit is een testbericht.</p>",
  };
  const first = await enqueueTransactionalMail(draft);
  const duplicate = await enqueueTransactionalMail(draft);
  assert.equal(first.queued, true);
  assert.deepEqual(duplicate, { id: first.id, queued: false });
  await assert.rejects(
    enqueueTransactionalMail({ ...draft, subject: "Andere inhoud" }),
    /Conflicterende idempotente mailaanvraag/,
  );

  const deliveries = [];
  const result = await processMailOutbox({
    limit: 1,
    environment: configuredEnvironment,
    deliver: async (mail) => {
      deliveries.push(mail);
      return { providerMessageId: "test-provider-id" };
    },
  });
  assert.equal(result.delivered, 1);
  assert.equal(deliveries[0].to, "klant@example.test");

  const sql = await getSql();
  const stored = await sql.query(
    `select status, attempt_count, provider_message_id, sent_at, last_error
     from transactional_mail_outbox where id = $1`,
    [first.id],
  );
  assert.equal(stored[0].status, "sent");
  assert.equal(stored[0].attempt_count, 1);
  assert.equal(stored[0].provider_message_id, "test-provider-id");
  assert.ok(stored[0].sent_at);
  assert.equal(stored[0].last_error, null);
});

test("a stale sending claim becomes delivery-uncertain and is never auto-resend", async () => {
  const queued = await enqueueTransactionalMail({
    dedupeKey: `test:${randomUUID()}:uncertain`,
    kind: "order_confirmation_customer",
    to: "klant@example.test",
    subject: "Mogelijk al geaccepteerd",
    textBody: "Deze testmail mag niet opnieuw worden verzonden.",
    htmlBody: "<p>Deze testmail mag niet opnieuw worden verzonden.</p>",
  });
  const sql = await getSql();
  let deliveryAttempts = 0;
  await assert.rejects(
    processMailOutbox({
      limit: 10,
      environment: configuredEnvironment,
      deliver: async (mail) => {
        deliveryAttempts += 1;
        // Model SMTP acceptance followed by a crash/lost DB claim before the
        // worker can persist `sent`.
        await sql.query(
          `update transactional_mail_outbox
           set locked_by = 'crashed-worker',
               locked_at = now() - interval '11 minutes'
           where id = $1`,
          [mail.id],
        );
        return { providerMessageId: "smtp-heeft-geaccepteerd" };
      },
    }),
    /geaccepteerde e-mailstatus/i,
  );
  assert.equal(deliveryAttempts, 1);

  const recovered = await processMailOutbox({
    limit: 10,
    environment: configuredEnvironment,
    deliver: async () => {
      deliveryAttempts += 1;
      return { providerMessageId: "mag-niet-gebeuren" };
    },
  });
  assert.equal(recovered.failed, 1);
  assert.equal(deliveryAttempts, 1);

  const uncertain = await sql.query(
    `select status, next_attempt_at, locked_at, locked_by, last_error
     from transactional_mail_outbox where id = $1`,
    [queued.id],
  );
  assert.deepEqual(uncertain, [
    {
      status: "failed",
      next_attempt_at: null,
      locked_at: null,
      locked_by: null,
      last_error: "delivery_uncertain_after_worker_timeout",
    },
  ]);

  await processMailOutbox({
    limit: 10,
    environment: configuredEnvironment,
    deliver: async () => {
      deliveryAttempts += 1;
      return { providerMessageId: "mag-niet-gebeuren" };
    },
  });
  assert.equal(deliveryAttempts, 1);
});

test("DATA and ambiguous socket failures become uncertain without automatic resend", async () => {
  const dataMail = await enqueueTransactionalMail({
    dedupeKey: `test:${randomUUID()}:data-uncertain`,
    kind: "contact_customer",
    to: "data@example.test",
    subject: "DATA onzeker",
    textBody: "Deze mail kan al zijn geaccepteerd.",
    htmlBody: "<p>Deze mail kan al zijn geaccepteerd.</p>",
  });
  const socketMail = await enqueueTransactionalMail({
    dedupeKey: `test:${randomUUID()}:socket-uncertain`,
    kind: "contact_customer",
    to: "socket@example.test",
    subject: "Socket onzeker",
    textBody: "Deze mail kan al zijn geaccepteerd.",
    htmlBody: "<p>Deze mail kan al zijn geaccepteerd.</p>",
  });
  let deliveryAttempts = 0;
  const result = await processMailOutbox({
    limit: 2,
    environment: configuredEnvironment,
    deliver: async (mail) => {
      deliveryAttempts += 1;
      if (mail.id === dataMail.id) {
        throw Object.assign(new Error("data@example.test geheim"), {
          code: "EMESSAGE",
          responseCode: 451,
          command: "DATA",
        });
      }
      throw Object.assign(new Error("socket@example.test geheim"), {
        code: "ESOCKET",
        command: "CONN",
      });
    },
  });
  assert.equal(result.failed, 2);
  assert.equal(result.deferred, 0);
  assert.equal(deliveryAttempts, 2);

  const sql = await getSql();
  const stored = await sql.query(
    `select id, status, attempt_count, next_attempt_at, last_error
     from transactional_mail_outbox where id in ($1, $2) order by id`,
    [dataMail.id, socketMail.id],
  );
  const byId = new Map(stored.map((row) => [row.id, row]));
  assert.deepEqual(byId.get(dataMail.id), {
    id: dataMail.id,
    status: "failed",
    attempt_count: 1,
    next_attempt_at: null,
    last_error: "delivery_uncertain_smtp_data",
  });
  assert.deepEqual(byId.get(socketMail.id), {
    id: socketMail.id,
    status: "failed",
    attempt_count: 1,
    next_attempt_at: null,
    last_error: "delivery_uncertain_smtp_transport",
  });

  await processMailOutbox({
    limit: 10,
    environment: configuredEnvironment,
    deliver: async () => {
      deliveryAttempts += 1;
      return { providerMessageId: "mag-niet-gebeuren" };
    },
  });
  assert.equal(deliveryAttempts, 2);
});

test("SMTP failures are sanitized, retried and eventually become terminal", async () => {
  const unique = randomUUID();
  const queued = await enqueueTransactionalMail({
    dedupeKey: `test:${unique}:retry`,
    kind: "contact_owner",
    to: "beheer@example.test",
    replyTo: "klant@example.test",
    subject: "Tijdelijke fout",
    textBody: "Dit is een testbericht.",
    htmlBody: "<p>Dit is een testbericht.</p>",
  });
  const secretErrorText = "klant@example.test smtp-password-123";
  const result = await processMailOutbox({
    limit: 1,
    environment: configuredEnvironment,
    deliver: async () => {
      throw Object.assign(new Error(secretErrorText), {
        code: "ECONNECTION",
        responseCode: 421,
        command: "CONN",
      });
    },
  });
  assert.equal(result.deferred, 1);

  const sql = await getSql();
  const stored = await sql.query(
    `select status, attempt_count, next_attempt_at, last_error
     from transactional_mail_outbox where id = $1`,
    [queued.id],
  );
  assert.equal(stored[0].status, "pending");
  assert.equal(stored[0].attempt_count, 1);
  assert.ok(stored[0].next_attempt_at);
  assert.equal(stored[0].last_error, "smtp_econnection_421_conn");
  assert.doesNotMatch(stored[0].last_error, /klant|password/);

  for (let attempt = 2; attempt <= 6; attempt += 1) {
    await sql.query(
      `update transactional_mail_outbox set next_attempt_at = now()
       where id = $1 and status = 'pending'`,
      [queued.id],
    );
    await processMailOutbox({
      limit: 1,
      environment: configuredEnvironment,
      deliver: async () => {
        throw Object.assign(new Error(secretErrorText), {
          code: "ECONNECTION",
          responseCode: 421,
          command: "CONN",
        });
      },
    });
  }

  const exhausted = await sql.query(
    `select status, attempt_count, next_attempt_at, last_error
     from transactional_mail_outbox where id = $1`,
    [queued.id],
  );
  assert.equal(exhausted[0].status, "failed");
  assert.equal(exhausted[0].attempt_count, 6);
  assert.equal(exhausted[0].next_attempt_at, null);
  assert.equal(exhausted[0].last_error, "smtp_econnection_421_conn");
});
