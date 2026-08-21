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
let accountVerificationMail;
let passwordResetMail;
let guestOrderClaimMail;
let SCRUBBED_MAIL_TEXT_BODY;
let SCRUBBED_MAIL_HTML_BODY;

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
  ({ SCRUBBED_MAIL_TEXT_BODY, SCRUBBED_MAIL_HTML_BODY } =
    await vite.ssrLoadModule("/src/lib/server/mail/body-retention.server.ts"));
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
  ({ accountVerificationMail, passwordResetMail, guestOrderClaimMail } =
    await vite.ssrLoadModule(
      "/src/lib/server/account-mail-templates.server.ts",
    ));
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
  assert.equal(configuration.fromName, "Afslank Injecties");
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

test("Hostinger SMTP password supports strict transport-safe base64", () => {
  const password = " bestaand%mail-wachtwoord:2026!🔐 ";
  const standard = Buffer.from(password, "utf8").toString("base64");
  const urlSafe = Buffer.from(password, "utf8").toString("base64url");
  const paddedUrlSafe = urlSafe.padEnd(
    urlSafe.length + ((4 - (urlSafe.length % 4)) % 4),
    "=",
  );
  for (const encoded of [
    standard,
    standard.replace(/=+$/, ""),
    urlSafe,
    paddedUrlSafe,
  ]) {
    const configuration = resolveMailConfiguration({
      SMTP_USER: "info@example.test",
      SMTP_PASSWORD_BASE64: encoded,
    });
    assert.equal(configuration.password, password, encoded);
  }

  const transition = resolveMailConfiguration({
    SMTP_USER: "info@example.test",
    SMTP_PASSWORD: "mogelijk-door-hostinger-gewijzigd",
    SMTP_PASSWORD_BASE64: Buffer.from(password, "utf8").toString("base64url"),
  });
  assert.equal(transition.password, password);

  for (const encoded of [
    "geen%base64",
    "YQ=",
    "_w",
    "AA==",
    Buffer.from("regel\nonderbreking", "utf8").toString("base64"),
  ]) {
    assert.throws(
      () =>
        resolveMailConfiguration({
          SMTP_USER: "info@example.test",
          SMTP_PASSWORD: "geldige-raw-fallback-mag-niet-worden-gebruikt",
          SMTP_PASSWORD_BASE64: encoded,
        }),
      /SMTP_PASSWORD_BASE64/,
      encoded,
    );
  }
});

test("contact templates are Dutch, escaped and promise 48 hours on workdays", () => {
  const owner = contactOwnerMail({
    name: "<Noor>",
    email: "noor@example.test",
    message: "Vraag <script>alert(1)</script>\nTweede regel",
  });
  const customer = contactCustomerReceiptMail({ name: "<Noor>" });

  assert.match(owner.textBody, /Nieuw contactbericht/);
  assert.equal(owner.htmlBody.toLowerCase().includes("<script>"), false);
  assert.match(owner.htmlBody, /&lt;script&gt;/);
  assert.match(customer.textBody, /binnen 48 uur op werkdagen/);
  assert.match(customer.htmlBody, /binnen 48 uur op werkdagen/);
  assert.doesNotMatch(customer.textBody, /Neem contact met ons op/i);
  assert.doesNotMatch(customer.htmlBody, /Contact opnemen/i);
  assert.match(customer.textBody, /Afslank-injecties\.nl/);
  assert.match(customer.htmlBody, /Afslank-injecties\.nl/);
  assert.doesNotMatch(customer.textBody, /\bVOLT\b/);
  assert.doesNotMatch(customer.htmlBody, /\bVOLT\b/);
  assert.doesNotMatch(customer.htmlBody, /Beste <Noor>/);
  for (const mail of [owner, customer]) {
    assert.match(mail.htmlBody, /max-width:600px/);
    assert.match(mail.htmlBody, /#0e7484/i);
    assert.match(mail.htmlBody, />Bezoek website<\/a>/);
    assert.doesNotMatch(mail.htmlBody, /#f06423/i);
    assert.doesNotMatch(mail.htmlBody, /<script|<style/i);
  }
});

test("account templates use the shared VOLT layout and preserve secure links", () => {
  const shared = {
    dedupeKey: "account-mail-test",
    userId: "user-test",
    email: "noor@example.test",
    name: "<Noor>",
  };
  const verification = accountVerificationMail({
    ...shared,
    url: "https://afslank-injecties.nl/api/auth/verify-email?token=test&callbackURL=%2Faccount",
  });
  const reset = passwordResetMail({
    ...shared,
    dedupeKey: "password-mail-test",
    url: "https://afslank-injecties.nl/api/auth/reset-password/test",
  });
  const claim = guestOrderClaimMail({
    ...shared,
    dedupeKey: "claim-mail-test",
    url: "https://afslank-injecties.nl/account#claim=test",
  });

  assert.equal(verification.kind, "account_verify");
  assert.equal(reset.kind, "account_password_reset");
  assert.equal(claim.kind, "guest_order_claim");
  assert.match(verification.textBody, /Deze link is 1 uur geldig/);
  assert.match(reset.textBody, /nieuw wachtwoord/);
  assert.match(claim.textBody, /30 minuten geldig/);
  assert.match(verification.htmlBody, /token=test&amp;callbackURL/);

  for (const mail of [verification, reset, claim]) {
    assert.doesNotMatch(mail.htmlBody, /Beste <Noor>/);
    assert.match(mail.htmlBody, /max-width:600px/);
    assert.match(mail.htmlBody, /#0e7484/i);
    assert.match(mail.htmlBody, />Bezoek website<\/a>/);
    assert.doesNotMatch(mail.htmlBody, /#f06423/i);
    assert.doesNotMatch(mail.htmlBody, /<script|<style/i);
  }
  assert.doesNotMatch(verification.htmlBody, /Hulp of een vraag\?/);
  assert.doesNotMatch(reset.htmlBody, /Hulp of een vraag\?/);
  assert.match(claim.htmlBody, /Hulp of een vraag\?/);
});

test("order templates escape customer data and omit removed warning copy", () => {
  const shared = {
    orderNumber: "MED-4000",
    name: "<Noor>",
    lines: [
      {
        name: "Semaglutide <script>",
        optionLabel: "4 mg & pen",
        qty: 2,
        slug: "semaglutide-4mg-pen",
        lineTotalCents: 16900,
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
  const customerWithAccount = orderCustomerConfirmationMail({
    ...shared,
    hasAccount: true,
  });
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
    assert.equal(mail.htmlBody.toLowerCase().includes("<script>"), false);
    assert.doesNotMatch(mail.htmlBody, /Beste <Noor>/);
    assert.doesNotMatch(mail.htmlBody, /\bVOLT\b/);
    assert.doesNotMatch(mail.textBody, /\bVOLT\b/);
    assert.match(mail.htmlBody, /max-width:600px/);
    assert.match(mail.htmlBody, /#0e7484/i);
    assert.match(mail.htmlBody, />Bezoek website<\/a>/);
    assert.doesNotMatch(mail.htmlBody, /#f06423/i);
    assert.doesNotMatch(mail.htmlBody, /<style/i);
  }
  assert.match(customer.textBody, /€\s*169,00/);
  assert.match(customer.textBody, /Bestelnummer: MED-4000/);
  assert.match(customer.textBody, /Producten:/);
  assert.match(customer.textBody, /Semaglutide <script>.*€\s*169,00/);
  assert.doesNotMatch(customer.textBody, /bedrag.*blijft leidend/i);
  assert.match(customer.textBody, /afslank-injecties\.nl\/registreren/);
  assert.doesNotMatch(customer.textBody, /veilige bevestigingslink/);
  assert.match(customer.textBody, /Neem contact met ons op/);
  assert.match(customer.htmlBody, /Bedankt voor je bestelling/);
  assert.match(customer.htmlBody, /Bestelnummer/);
  assert.match(customer.htmlBody, /Producten/);
  assert.match(customer.htmlBody, /Bezorgadres/);
  assert.match(customer.htmlBody, /#0e7484/i);
  assert.match(customer.htmlBody, /role="presentation"/);
  assert.match(customer.htmlBody, /max-width:600px/);
  assert.match(customer.htmlBody, /font-size:18px/);
  assert.match(customer.htmlBody, /href="https:\/\/afslank-injecties\.nl"/);
  assert.match(customer.htmlBody, /€\s*169,00/);
  assert.match(
    customer.htmlBody,
    /src="https:\/\/afslank-injecties\.nl\/images\/producten\/semaglutide-4mg-pen__01__800\.webp"/,
  );
  assert.match(customer.htmlBody, /width="64" height="64"/);
  assert.match(customer.htmlBody, />Contact opnemen<\/a>/);
  assert.equal(
    customer.htmlBody.match(/<table role="presentation" width="160"/g)
      ?.length,
    2,
  );
  assert.match(customer.htmlBody, /bgcolor="#0e7484"/);
  assert.match(
    customer.htmlBody,
    /src="https:\/\/afslank-injecties\.nl\/images\/mail\/ai-support\.png"/,
  );
  assert.match(customer.htmlBody, /alt="Hulp en contact"/);
  assert.match(customer.htmlBody, /Afslanken met injecties/);
  assert.match(customer.htmlBody, />Bezoek website<\/a>/);
  assert.match(customer.htmlBody, /bgcolor="#0b0c0f"/);
  assert.match(customerWithAccount.htmlBody, /terug in je account/);
  assert.doesNotMatch(customerWithAccount.htmlBody, /Account aanmaken/);
  assert.doesNotMatch(customer.htmlBody, /#f06423/i);
  assert.doesNotMatch(customer.htmlBody, /<script|<style/i);
  assert.doesNotMatch(customer.htmlBody, /tracking|width="1"|height="1"/i);
  assert.match(status.textBody, /Verzonden/);
  assert.match(address.textBody, /Test & Straat/);
  assert.doesNotMatch(address.textBody, /niet verwacht|Neem dan/i);
  assert.doesNotMatch(address.htmlBody, /Niet door jou gewijzigd|Neem dan/i);
  assert.doesNotMatch(products.textBody, /bedrag|niet verwacht|Neem dan/i);
  assert.doesNotMatch(products.htmlBody, /Vastgelegd bedrag|blijft ongewijzigd|niet verwacht|Neem dan/i);
});

test("outbox deduplicates and marks successful delivery", async () => {
  const unique = randomUUID();
  const draft = {
    dedupeKey: `test:${unique}:success`,
    kind: "account_password_reset",
    to: "klant@example.test",
    subject: "Testbevestiging",
    textBody:
      "Open https://example.test/account#token=zeer-geheime-testtoken om door te gaan.",
    htmlBody:
      '<p>Open <a href="https://example.test/account#token=zeer-geheime-testtoken">je veilige link</a>.</p>',
  };
  const first = await enqueueTransactionalMail(draft);
  const duplicate = await enqueueTransactionalMail(draft);
  assert.equal(first.queued, true);
  assert.deepEqual(duplicate, { id: first.id, queued: false });
  await assert.rejects(
    enqueueTransactionalMail({ ...draft, subject: "Andere inhoud" }),
    /Conflicterende idempotente mailaanvraag/,
  );
  await assert.rejects(
    enqueueTransactionalMail({
      ...draft,
      textBody: `${draft.textBody} andere inhoud`,
    }),
    /Conflicterende idempotente mailaanvraag/,
  );
  await assert.rejects(
    enqueueTransactionalMail({
      ...draft,
      dedupeKey: `test:${unique}:reserved`,
      textBody: SCRUBBED_MAIL_TEXT_BODY,
    }),
    /gereserveerde waarde/,
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
    `select status, attempt_count, provider_message_id, sent_at, last_error,
            text_body, html_body
     from transactional_mail_outbox where id = $1`,
    [first.id],
  );
  assert.equal(stored[0].status, "sent");
  assert.equal(stored[0].attempt_count, 1);
  assert.equal(stored[0].provider_message_id, "test-provider-id");
  assert.ok(stored[0].sent_at);
  assert.equal(stored[0].last_error, null);
  assert.equal(stored[0].text_body, SCRUBBED_MAIL_TEXT_BODY);
  assert.equal(stored[0].html_body, SCRUBBED_MAIL_HTML_BODY);
  assert.doesNotMatch(stored[0].text_body, /zeer-geheime-testtoken/);
  assert.doesNotMatch(stored[0].html_body, /zeer-geheime-testtoken/);

  assert.deepEqual(await enqueueTransactionalMail(draft), {
    id: first.id,
    queued: false,
  });
  assert.deepEqual(
    await enqueueTransactionalMail({
      ...draft,
      textBody: `${draft.textBody} inhoud die niet meer wordt verzonden`,
    }),
    { id: first.id, queued: false },
  );
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
    `select status, next_attempt_at, locked_at, locked_by, last_error,
            text_body, html_body
     from transactional_mail_outbox where id = $1`,
    [queued.id],
  );
  assert.equal(uncertain[0].status, "failed");
  assert.equal(uncertain[0].next_attempt_at, null);
  assert.equal(uncertain[0].locked_at, null);
  assert.equal(uncertain[0].locked_by, null);
  assert.equal(
    uncertain[0].last_error,
    "delivery_uncertain_after_worker_timeout",
  );
  assert.equal(uncertain[0].text_body, SCRUBBED_MAIL_TEXT_BODY);
  assert.equal(uncertain[0].html_body, SCRUBBED_MAIL_HTML_BODY);
  assert.doesNotMatch(uncertain[0].text_body, /niet opnieuw worden verzonden/);
  assert.doesNotMatch(uncertain[0].html_body, /niet opnieuw worden verzonden/);

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
    `select id, status, attempt_count, next_attempt_at, last_error,
            text_body, html_body
     from transactional_mail_outbox where id in ($1, $2) order by id`,
    [dataMail.id, socketMail.id],
  );
  const byId = new Map(stored.map((row) => [row.id, row]));
  for (const [id, lastError] of [
    [dataMail.id, "delivery_uncertain_smtp_data"],
    [socketMail.id, "delivery_uncertain_smtp_transport"],
  ]) {
    const row = byId.get(id);
    assert.equal(row.id, id);
    assert.equal(row.status, "failed");
    assert.equal(row.attempt_count, 1);
    assert.equal(row.next_attempt_at, null);
    assert.equal(row.last_error, lastError);
    assert.equal(row.text_body, SCRUBBED_MAIL_TEXT_BODY);
    assert.equal(row.html_body, SCRUBBED_MAIL_HTML_BODY);
    assert.doesNotMatch(row.text_body, /kan al zijn geaccepteerd/);
    assert.doesNotMatch(row.html_body, /kan al zijn geaccepteerd/);
  }

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
    `select status, attempt_count, next_attempt_at, last_error,
            text_body, html_body
     from transactional_mail_outbox where id = $1`,
    [queued.id],
  );
  assert.equal(stored[0].status, "pending");
  assert.equal(stored[0].attempt_count, 1);
  assert.ok(stored[0].next_attempt_at);
  assert.equal(stored[0].last_error, "smtp_econnection_421_conn");
  assert.doesNotMatch(stored[0].last_error, /klant|password/);
  assert.equal(stored[0].text_body, "Dit is een testbericht.");
  assert.equal(stored[0].html_body, "<p>Dit is een testbericht.</p>");

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
    `select status, attempt_count, next_attempt_at, last_error,
            text_body, html_body
     from transactional_mail_outbox where id = $1`,
    [queued.id],
  );
  assert.equal(exhausted[0].status, "failed");
  assert.equal(exhausted[0].attempt_count, 6);
  assert.equal(exhausted[0].next_attempt_at, null);
  assert.equal(exhausted[0].last_error, "smtp_econnection_421_conn");
  assert.equal(exhausted[0].text_body, SCRUBBED_MAIL_TEXT_BODY);
  assert.equal(exhausted[0].html_body, SCRUBBED_MAIL_HTML_BODY);
});
