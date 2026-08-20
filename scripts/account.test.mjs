import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";

let vite;
let auth;
let getSql;
let createOrderRecord;
let confirmGuestOrderClaimRecord;
let listAccountOrderRecords;
let requestGuestOrderClaimRecord;
let issueAddressValidationToken;

process.env.ADDRESS_VALIDATION_TOKEN_SECRET =
  "account-address-validation-secret-with-at-least-32-characters";

function checkoutInput(email, overrides = {}) {
  const input = {
    name: "Historische Klant",
    email,
    phone: "0612345678",
    street: "Oude Teststraat",
    houseNumber: "27 B",
    postcode: "1234 AB",
    city: "Utrecht",
    country: "NL",
    note: "Adres en bedrag moeten een historische snapshot blijven.",
    lines: [{ slug: "semaglutide-2mg", optionId: "none", qty: 1 }],
    discountCode: null,
    idempotencyKey: randomUUID(),
    ...overrides,
  };
  return {
    ...input,
    addressValidationToken:
      overrides.addressValidationToken ??
      issueAddressValidationToken({
        address: input,
        provider: input.country === "NL" ? "apicheck" : "google",
      }),
  };
}

async function insertUser({ id, email, verified = true }) {
  const sql = await getSql();
  await sql.query(
    `insert into "user" (
      "id", "name", "email", "emailVerified", "createdAt", "updatedAt"
    ) values ($1, $2, $3, $4, now(), now())`,
    [id, "Account Test", email, verified],
  );
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
  ({ auth } = await vite.ssrLoadModule("/src/lib/auth/server.ts"));
  ({ createOrderRecord } = await vite.ssrLoadModule(
    "/src/lib/server/orders.server.ts",
  ));
  ({
    confirmGuestOrderClaimRecord,
    listAccountOrderRecords,
    requestGuestOrderClaimRecord,
  } = await vite.ssrLoadModule("/src/lib/server/account.server.ts"));
});

after(async () => {
  await vite?.close();
});

test("email/password signup requires verification and queues a hashed verification link", async () => {
  const email = `account-auth-${randomUUID()}@example.test`;
  const result = await auth.api.signUpEmail({
    body: {
      name: "Nieuwe Klant",
      email,
      password: "Een-sterk-wachtwoord-2026",
      callbackURL: "/login?verified=1",
    },
    headers: new Headers({ origin: "http://localhost:8080" }),
  });

  assert.equal(result.token, null);
  assert.equal(result.user.emailVerified, false);
  const sql = await getSql();
  const queued = await sql.query(
    `select dedupe_key, kind, recipient, text_body, user_id
     from transactional_mail_outbox
     where kind = 'account_verify' and recipient = $1`,
    [email],
  );
  assert.equal(queued.length, 1);
  assert.match(queued[0].dedupe_key, /^account-verify:[a-f0-9]{64}$/);
  assert.equal(queued[0].user_id, result.user.id);
  assert.match(queued[0].text_body, /Bevestig je e-mailadres/);
  assert.equal(
    queued[0].text_body.includes(queued[0].dedupe_key.slice(15)),
    false,
  );
});

test("verification, forgotten password and password change work through Better Auth", async () => {
  const email = `password-flow-${randomUUID()}@example.test`;
  const firstPassword = "Eerste-sterke-code-2026";
  const resetPassword = "Tweede-sterke-code-2026";
  const finalPassword = "Derde-sterke-code-2026";
  const signedUp = await auth.api.signUpEmail({
    body: {
      name: "Wachtwoord Klant",
      email,
      password: firstPassword,
      callbackURL: "/login?verified=1",
    },
    headers: new Headers({ origin: "http://localhost:8080" }),
  });
  const sql = await getSql();
  const verificationMails = await sql.query(
    `select text_body
     from transactional_mail_outbox
     where kind = 'account_verify' and recipient = $1
     order by created_at desc limit 1`,
    [email],
  );
  const verificationUrl =
    verificationMails[0]?.text_body.match(/https?:\/\/\S+/)?.[0];
  assert.ok(verificationUrl);
  const verificationToken = new URL(verificationUrl).searchParams.get("token");
  assert.ok(verificationToken);
  await auth.api.verifyEmail({ query: { token: verificationToken } });

  const firstSession = await auth.api.signInEmail({
    body: { email, password: firstPassword },
    headers: new Headers({ origin: "http://localhost:8080" }),
  });
  assert.ok(firstSession.token);

  const resetRequest = await auth.api.requestPasswordReset({
    body: { email, redirectTo: "/wachtwoord-herstellen" },
    headers: new Headers({ origin: "http://localhost:8080" }),
  });
  assert.equal(resetRequest.status, true);
  const resetMails = await sql.query(
    `select dedupe_key, text_body, user_id
     from transactional_mail_outbox
     where kind = 'account_password_reset' and recipient = $1
     order by created_at desc limit 1`,
    [email],
  );
  assert.match(
    resetMails[0].dedupe_key,
    /^account-password-reset:[a-f0-9]{64}$/,
  );
  assert.equal(resetMails[0].user_id, signedUp.user.id);
  const resetUrl = resetMails[0]?.text_body.match(/https?:\/\/\S+/)?.[0];
  assert.ok(resetUrl);
  const resetToken = new URL(resetUrl).pathname.split("/").at(-1);
  assert.ok(resetToken);
  await auth.api.resetPassword({
    body: { token: resetToken, newPassword: resetPassword },
  });
  assert.deepEqual(
    await sql.query('select id from "session" where "userId" = $1', [
      signedUp.user.id,
    ]),
    [],
    "wachtwoordherstel hoort bestaande sessies in te trekken",
  );

  const resetSession = await auth.api.signInEmail({
    body: { email, password: resetPassword },
    headers: new Headers({ origin: "http://localhost:8080" }),
  });
  assert.ok(resetSession.token);
  await auth.api.changePassword({
    body: {
      currentPassword: resetPassword,
      newPassword: finalPassword,
      revokeOtherSessions: true,
    },
    headers: new Headers({ authorization: `Bearer ${resetSession.token}` }),
  });
  await assert.rejects(
    auth.api.signInEmail({
      body: { email, password: resetPassword },
      headers: new Headers({ origin: "http://localhost:8080" }),
    }),
  );
  const finalSession = await auth.api.signInEmail({
    body: { email, password: finalPassword },
    headers: new Headers({ origin: "http://localhost:8080" }),
  });
  assert.ok(finalSession.token);
});

test("a single-use mailbox link claims only matching unowned guest orders", async () => {
  const accountId = randomUUID();
  const accountEmail = `claim-${randomUUID()}@example.test`;
  const otherUserId = randomUUID();
  await insertUser({ id: accountId, email: accountEmail });
  await insertUser({
    id: otherUserId,
    email: `other-${randomUUID()}@example.test`,
  });

  const claimable = await createOrderRecord(checkoutInput(accountEmail));
  const alreadyOwned = await createOrderRecord(
    checkoutInput(accountEmail, { idempotencyKey: randomUUID() }),
    { userId: otherUserId },
  );
  const unrelated = await createOrderRecord(
    checkoutInput(`unrelated-${randomUUID()}@example.test`),
  );

  await requestGuestOrderClaimRecord({
    userId: accountId,
    publicOrigin: "https://afslank-injecties.nl",
  });
  const sql = await getSql();
  const queued = await sql.query(
    `select text_body
     from transactional_mail_outbox
     where kind = 'guest_order_claim' and recipient = $1
     order by created_at desc
     limit 1`,
    [accountEmail],
  );
  const token = queued[0]?.text_body.match(/#claim=([A-Za-z0-9_-]+)/)?.[1];
  assert.ok(
    token,
    "de claimtoken hoort alleen in de bevestigingslink te staan",
  );

  const stored = await sql.query(
    `select token_hash, normalized_email_hash, consumed_at
     from order_claim_tokens
     where user_id = $1
     order by issued_at desc
     limit 1`,
    [accountId],
  );
  assert.match(stored[0].token_hash, /^[a-f0-9]{64}$/);
  assert.equal(stored[0].token_hash.includes(token), false);
  assert.match(stored[0].normalized_email_hash, /^[a-f0-9]{64}$/);
  assert.equal(stored[0].consumed_at, null);

  const confirmed = await confirmGuestOrderClaimRecord({
    userId: accountId,
    token,
  });
  assert.deepEqual(confirmed, { linkedOrders: 1 });
  await assert.rejects(
    confirmGuestOrderClaimRecord({ userId: accountId, token }),
    /ongeldig, verlopen of al gebruikt/i,
  );

  const owners = await sql.query(
    "select id, user_id from orders where id = any($1) order by id",
    [[claimable.order.id, alreadyOwned.order.id, unrelated.order.id]],
  );
  const ownerById = new Map(owners.map((row) => [row.id, row.user_id]));
  assert.equal(ownerById.get(claimable.order.id), accountId);
  assert.equal(ownerById.get(alreadyOwned.order.id), otherUserId);
  assert.equal(ownerById.get(unrelated.order.id), null);
});

test("concurrent guest-order claim requests leave only one valid link", async () => {
  const accountId = randomUUID();
  const accountEmail = `claim-concurrent-${randomUUID()}@example.test`;
  await insertUser({ id: accountId, email: accountEmail });

  await Promise.all([
    requestGuestOrderClaimRecord({
      userId: accountId,
      publicOrigin: "https://afslank-injecties.nl",
    }),
    requestGuestOrderClaimRecord({
      userId: accountId,
      publicOrigin: "https://afslank-injecties.nl",
    }),
  ]);

  const sql = await getSql();
  const active = await sql.query(
    `select count(*)::int as count
     from order_claim_tokens
     where user_id = $1 and consumed_at is null and expires_at > now()`,
    [accountId],
  );
  assert.deepEqual(active, [{ count: 1 }]);

  const mails = await sql.query(
    `select text_body
     from transactional_mail_outbox
     where kind = 'guest_order_claim' and user_id = $1
     order by created_at, id`,
    [accountId],
  );
  assert.equal(mails.length, 2);
  const tokens = mails.map(
    (mail) => mail.text_body.match(/#claim=([A-Za-z0-9_-]+)/)?.[1],
  );
  assert.ok(tokens.every(Boolean));

  const confirmations = await Promise.allSettled(
    tokens.map((token) =>
      confirmGuestOrderClaimRecord({ userId: accountId, token }),
    ),
  );
  assert.equal(
    confirmations.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    confirmations.filter((result) => result.status === "rejected").length,
    1,
  );

  const accountServer = await readFile(
    new URL("../src/lib/server/account.server.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    accountServer,
    /from "user"[\s\S]{0,160}?where "id" = \$\{userId\}[\s\S]{0,80}?for update/,
  );
});

test("account history returns immutable line prices, checkout address and only public tracking fields", async () => {
  const accountId = randomUUID();
  const email = `history-${randomUUID()}@example.test`;
  await insertUser({ id: accountId, email });
  const created = await createOrderRecord(checkoutInput(email), {
    userId: accountId,
  });
  const sql = await getSql();
  await sql.query(
    `insert into order_shipments (
      id, order_id, reference_identifier, create_idempotency_key, payload_hash,
      creation_status, provider_shipment_id, barcode, tracking_url,
      tracking_status, label_status, last_synced_at, created_at, updated_at
    ) values (
      $1, $2, $3, $4, $5, 'created', $6, $7, $8,
      'in_transit', 'ready', now(), now(), now()
    )`,
    [
      randomUUID(),
      created.order.id,
      `ref-${randomUUID()}`,
      `idem-${randomUUID()}`,
      "a".repeat(64),
      `provider-${randomUUID()}`,
      `3S${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
      "https://tracking.example.test/public-link",
    ],
  );

  const history = await listAccountOrderRecords(accountId);
  assert.equal(history.length, 1);
  const order = history[0];
  assert.equal(order.totalCents, 8995);
  assert.equal(order.lines[0].unitPriceCents, 8500);
  assert.equal(order.street, "Oude Teststraat");
  assert.equal(order.houseNumber, "27 B");
  assert.equal(order.postcode, "1234 AB");
  assert.equal(order.tracking.trackingStatus, "in_transit");
  assert.equal(
    order.tracking.trackingUrl,
    "https://tracking.example.test/public-link",
  );
  assert.deepEqual(Object.keys(order.tracking).sort(), [
    "barcode",
    "lastSyncedAt",
    "trackingStatus",
    "trackingUrl",
  ]);
  assert.equal("providerShipmentId" in order.tracking, false);
});

test("account history hides shipments that were not created", async () => {
  const accountId = randomUUID();
  const email = `uncreated-shipment-${randomUUID()}@example.test`;
  await insertUser({ id: accountId, email });
  const sql = await getSql();

  for (const creationStatus of ["pending", "ambiguous", "failed"]) {
    const created = await createOrderRecord(checkoutInput(email), {
      userId: accountId,
    });
    const shipmentId = randomUUID();
    await sql.query(
      `insert into order_shipments (
        id, order_id, reference_identifier, create_idempotency_key,
        payload_hash, creation_status, tracking_status, created_at, updated_at
      ) values ($1, $2, $3, $4, $5, $6, 'concept', now(), now())`,
      [
        shipmentId,
        created.order.id,
        `ref-${shipmentId}`,
        `shipment-${shipmentId}`,
        "a".repeat(64),
        creationStatus,
      ],
    );
  }

  const history = await listAccountOrderRecords(accountId);
  assert.equal(history.length, 3);
  assert.ok(history.every((order) => order.tracking === null));
});

test("checkout keeps every address field mandatory even for signed-in orders", async () => {
  const checkout = await readFile(
    new URL("../src/routes/checkout.tsx", import.meta.url),
    "utf8",
  );
  for (const field of ["street", "houseNumber", "postcode", "city"]) {
    assert.match(
      checkout,
      new RegExp(`name=\\"${field}\\"[\\s\\S]{0,180}?required`),
      `${field} moet bij iedere checkout verplicht blijven`,
    );
  }
  assert.match(checkout, /name="country"[\s\S]{0,220}?defaultValue="NL"/);
});

test("the customer account is directly available from the main header", async () => {
  const header = await readFile(
    new URL("../src/components/site-header.tsx", import.meta.url),
    "utf8",
  );
  assert.match(header, /href="\/account"/);
  assert.match(header, /aria-label="Mijn account"/);
});
