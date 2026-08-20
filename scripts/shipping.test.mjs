import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";

let vite;
let getSql;
let withSqlTransaction;
let createOrderRecord;
let getOrderRecordForViewer;
let issueAddressValidationToken;
let createMyParcelConceptRecord;
let requestMyParcelLabelRecord;
let refreshMyParcelTrackingRecord;
let updateOrderAddressRecord;
let updateOrderFulfillmentRecord;
let updateOrderStatusRecord;
let ShipmentActionError;
let IntegrationError;
let ORDER_SERVER_ERROR_POLICY;
let resolvePublicServerError;
let createIdempotentShipmentService;
let createSqlShipmentCreationRepository;

process.env.ADDRESS_VALIDATION_TOKEN_SECRET =
  "shipping-address-validation-secret-with-at-least-32-characters";

function orderInput() {
  const address = {
    street: "Teststraat",
    houseNumber: "12 A",
    postcode: "1234 AB",
    city: "Utrecht",
    country: "NL",
  };
  return {
    name: "Verzend Tester",
    email: `shipping-${randomUUID()}@example.test`,
    phone: "0612345678",
    ...address,
    note: "Gerichte MyParcel-test zonder echte API-aanroep.",
    lines: [{ slug: "semaglutide-2mg", optionId: "none", qty: 1 }],
    discountCode: null,
    idempotencyKey: randomUUID(),
    addressValidationToken: issueAddressValidationToken({
      address,
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
  ({ getSql, withSqlTransaction } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ issueAddressValidationToken } = await vite.ssrLoadModule(
    "/src/lib/server/address-validation-token.server.ts",
  ));
  ({
    createOrderRecord,
    getOrderRecordForViewer,
    updateOrderAddressRecord,
    updateOrderFulfillmentRecord,
    updateOrderStatusRecord,
  } = await vite.ssrLoadModule("/src/lib/server/orders.server.ts"));
  ({
    createMyParcelConceptRecord,
    requestMyParcelLabelRecord,
    refreshMyParcelTrackingRecord,
  } = await vite.ssrLoadModule("/src/lib/server/shipping.server.ts"));
  ({ ShipmentActionError } = await vite.ssrLoadModule(
    "/src/lib/server/shipping.server.ts",
  ));
  ({ IntegrationError } = await vite.ssrLoadModule(
    "/src/lib/server/integrations/integration-error.ts",
  ));
  ({ ORDER_SERVER_ERROR_POLICY } = await vite.ssrLoadModule(
    "/src/lib/server/orders.ts",
  ));
  ({ resolvePublicServerError } = await vite.ssrLoadModule(
    "/src/lib/server-error.ts",
  ));
  ({ createIdempotentShipmentService } = await vite.ssrLoadModule(
    "/src/lib/server/integrations/myparcel.server.ts",
  ));
  ({ createSqlShipmentCreationRepository } = await vite.ssrLoadModule(
    "/src/lib/server/integrations/shipment-repository.server.ts",
  ));
});

after(async () => {
  await vite?.close();
});

test("order bewaart een geldig adresbewijs en weigert gewijzigd adres", async () => {
  const input = orderInput();
  const created = await createOrderRecord(input);
  const sql = await getSql();
  const rows = await sql.query(
    `select address_validation_provider, address_validation_status,
       address_validation_fingerprint, address_validated_at
     from orders where id = $1`,
    [created.order.id],
  );
  assert.equal(rows[0].address_validation_provider, "apicheck");
  assert.equal(rows[0].address_validation_status, "valid");
  assert.match(rows[0].address_validation_fingerprint, /^[a-f0-9]{64}$/);
  assert.ok(rows[0].address_validated_at);

  await assert.rejects(
    createOrderRecord({
      ...input,
      idempotencyKey: randomUUID(),
      houseNumber: "13",
    }),
    /Controleer het bezorgadres opnieuw/,
  );
});

test("admin kan een gewijzigd adres expliciet opnieuw valideren", async () => {
  const created = await createOrderRecord(orderInput());
  const changed = await updateOrderAddressRecord({
    id: created.order.id,
    expectedUpdatedAt: created.order.updatedAt,
    name: created.order.name,
    phone: created.order.phone ?? undefined,
    street: "Nieuwe Teststraat",
    houseNumber: "14",
    postcode: "1234 AB",
    city: "Utrecht",
    country: "NL",
  });
  assert.equal(changed.addressValidationStatus, "unvalidated");

  const validationToken = issueAddressValidationToken({
    address: {
      street: changed.street,
      houseNumber: changed.houseNumber,
      postcode: changed.postcode,
      city: changed.city,
      country: changed.country,
    },
    provider: "apicheck",
  });
  const validated = await updateOrderAddressRecord({
    id: changed.id,
    expectedUpdatedAt: changed.updatedAt,
    name: changed.name,
    phone: changed.phone ?? undefined,
    street: changed.street,
    houseNumber: changed.houseNumber,
    postcode: changed.postcode,
    city: changed.city,
    country: changed.country,
    addressValidationToken: validationToken,
  });
  assert.equal(validated.addressValidationStatus, "valid");
});

test("shipmentclaim herverifieert de adresfingerprint atomair vóór providergebruik", async () => {
  const created = await createOrderRecord(orderInput());
  const sql = await getSql();
  await sql.query("update orders set status = 'paid' where id = $1", [
    created.order.id,
  ]);
  const rows = await sql.query(
    `select address_validation_fingerprint from orders where id = $1`,
    [created.order.id],
  );
  const originalFingerprint = rows[0].address_validation_fingerprint;
  await sql.query(
    `update orders
     set street = 'Gewijzigde straat', address_validation_status = 'unvalidated',
         address_validation_provider = null,
         address_validation_fingerprint = null, address_validated_at = null,
         updated_at = now()
     where id = $1`,
    [created.order.id],
  );

  let providerCalls = 0;
  const service = createIdempotentShipmentService({
    repository: createSqlShipmentCreationRepository(),
    client: {
      async findByReference() {
        providerCalls += 1;
        return [];
      },
      async createConceptShipment() {
        providerCalls += 1;
        throw new Error("mag niet worden aangeroepen");
      },
    },
  });
  await assert.rejects(
    service.ensureShipment({
      orderId: created.order.id,
      idempotencyKey: `myparcel:${created.order.id}:v1`,
      addressFingerprint: originalFingerprint,
      draft: {
        referenceIdentifier: created.order.orderNumber,
        recipient: {
          country: "NL",
          city: "Utrecht",
          street: "Teststraat",
          houseNumber: "12",
          houseNumberAddition: "A",
          postcode: "1234 AB",
          person: created.order.name,
          email: created.order.email,
        },
      },
    }),
    /bezorgadres is intussen gewijzigd/i,
  );
  assert.equal(providerCalls, 0);
});

test("statusrace vóór conceptclaim blokkeert provider voor cancelled en shipped", async () => {
  for (const nextStatus of ["cancelled", "shipped"]) {
    const created = await createOrderRecord(orderInput());
    const sql = await getSql();
    await sql.query("update orders set status = 'paid' where id = $1", [
      created.order.id,
    ]);
    const rows = await sql.query(
      `select address_validation_fingerprint from orders where id = $1`,
      [created.order.id],
    );
    const staleFingerprint = rows[0].address_validation_fingerprint;

    let releaseStatusLock;
    let signalStatusLocked;
    const statusLocked = new Promise((resolve) => {
      signalStatusLocked = resolve;
    });
    const holdStatusLock = new Promise((resolve) => {
      releaseStatusLock = resolve;
    });
    const statusChange = withSqlTransaction(async (transaction) => {
      await transaction`
        update orders set status = ${nextStatus}, updated_at = now()
        where id = ${created.order.id}
      `;
      signalStatusLocked();
      await holdStatusLock;
    });
    await statusLocked;

    let providerCalls = 0;
    const service = createIdempotentShipmentService({
      repository: createSqlShipmentCreationRepository(),
      client: {
        async findByReference() {
          providerCalls += 1;
          return [];
        },
        async createConceptShipment() {
          providerCalls += 1;
          throw new Error("provider mag niet worden aangeroepen");
        },
      },
    });
    const conceptClaim = service.ensureShipment({
      orderId: created.order.id,
      idempotencyKey: `myparcel:${created.order.id}:v1`,
      addressFingerprint: staleFingerprint,
      draft: {
        referenceIdentifier: created.order.orderNumber,
        recipient: {
          country: "NL",
          city: created.order.city,
          street: created.order.street,
          houseNumber: "12",
          houseNumberAddition: "A",
          postcode: created.order.postcode,
          person: created.order.name,
          email: created.order.email,
        },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(providerCalls, 0, nextStatus);
    releaseStatusLock();
    await statusChange;
    await assert.rejects(
      conceptClaim,
      /bestelstatus is intussen gewijzigd/i,
      nextStatus,
    );
    assert.equal(providerCalls, 0, nextStatus);
    const shipments = await sql.query(
      "select id from order_shipments where order_id = $1",
      [created.order.id],
    );
    assert.equal(shipments.length, 0, nextStatus);
  }
});

test("lopende shipmentclaim blokkeert een gelijktijdige adreswijziging", async () => {
  const created = await createOrderRecord(orderInput());
  const sql = await getSql();
  await sql.query("update orders set status = 'paid' where id = $1", [
    created.order.id,
  ]);
  const paid = await getOrderRecordForViewer({
    id: created.order.id,
    isAdmin: true,
  });

  let releaseFind;
  let signalFindStarted;
  const findStarted = new Promise((resolve) => {
    signalFindStarted = resolve;
  });
  const waitForRelease = new Promise((resolve) => {
    releaseFind = resolve;
  });
  const conceptPromise = createMyParcelConceptRecord(created.order.id, {
    client: {
      async findByReference() {
        signalFindStarted();
        await waitForRelease;
        return [];
      },
      async createConceptShipment(draft) {
        return {
          id: "555001",
          referenceIdentifier: draft.referenceIdentifier,
          statusCode: 1,
          trackingStatus: "concept",
          carrierId: 1,
          barcode: null,
        };
      },
    },
  });
  await findStarted;
  await assert.rejects(
    updateOrderAddressRecord({
      id: paid.id,
      expectedUpdatedAt: paid.updatedAt,
      name: paid.name,
      phone: paid.phone ?? undefined,
      street: "Race straat",
      houseNumber: paid.houseNumber,
      postcode: paid.postcode,
      city: paid.city,
      country: paid.country,
    }),
    /kan niet meer worden gewijzigd/i,
  );
  releaseFind();
  const shipment = await conceptPromise;
  assert.equal(shipment.shipment.creationStatus, "created");
  const stored = await getOrderRecordForViewer({
    id: paid.id,
    isAdmin: true,
  });
  assert.equal(stored.street, paid.street);
});

test("pending, ambiguous en created shipmentstatus vergrendelen adreswijziging", async () => {
  const sql = await getSql();
  for (const status of ["pending", "ambiguous", "created"]) {
    const created = await createOrderRecord(orderInput());
    await sql.query(
      `insert into order_shipments (
         id, order_id, reference_identifier, create_idempotency_key,
         payload_hash, creation_status, provider_shipment_id
       ) values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        randomUUID(),
        created.order.id,
        `${created.order.orderNumber}-${status}`,
        `lock-${created.order.id}-${status}`,
        "f".repeat(64),
        status,
        status === "created"
          ? `${Date.now()}${Math.floor(Math.random() * 1000)}`
          : null,
      ],
    );
    await assert.rejects(
      updateOrderAddressRecord({
        id: created.order.id,
        expectedUpdatedAt: created.order.updatedAt,
        name: created.order.name,
        phone: created.order.phone ?? undefined,
        street: `${status} straat`,
        houseNumber: created.order.houseNumber,
        postcode: created.order.postcode,
        city: created.order.city,
        country: created.order.country,
      }),
      /kan niet meer worden gewijzigd/i,
      status,
    );
  }
});

test("failed shipment laat adrescorrectie en veilige payload-reset toe", async () => {
  const created = await createOrderRecord(orderInput());
  const sql = await getSql();
  await sql.query("update orders set status = 'paid' where id = $1", [
    created.order.id,
  ]);
  let createCalls = 0;
  await assert.rejects(
    createMyParcelConceptRecord(created.order.id, {
      client: {
        async findByReference() {
          return [];
        },
        async createConceptShipment() {
          createCalls += 1;
          throw new IntegrationError({
            provider: "myparcel",
            code: "remote_rejected",
            retryable: false,
            httpStatus: 422,
          });
        },
      },
    }),
    /niet geaccepteerd/i,
  );
  assert.equal(createCalls, 1);
  const failedRows = await sql.query(
    `select creation_status, payload_hash
     from order_shipments where order_id = $1`,
    [created.order.id],
  );
  assert.equal(failedRows[0].creation_status, "failed");
  const originalPayloadHash = failedRows[0].payload_hash;

  const current = await getOrderRecordForViewer({
    id: created.order.id,
    isAdmin: true,
  });
  const changed = await updateOrderAddressRecord({
    id: current.id,
    expectedUpdatedAt: current.updatedAt,
    name: current.name,
    phone: current.phone ?? undefined,
    street: "Herstelde straat",
    houseNumber: "44 B",
    postcode: current.postcode,
    city: current.city,
    country: current.country,
  });
  assert.equal(changed.addressValidationStatus, "unvalidated");
  const validationToken = issueAddressValidationToken({
    address: {
      street: changed.street,
      houseNumber: changed.houseNumber,
      postcode: changed.postcode,
      city: changed.city,
      country: changed.country,
    },
    provider: "apicheck",
  });
  const validated = await updateOrderAddressRecord({
    id: changed.id,
    expectedUpdatedAt: changed.updatedAt,
    name: changed.name,
    phone: changed.phone ?? undefined,
    street: changed.street,
    houseNumber: changed.houseNumber,
    postcode: changed.postcode,
    city: changed.city,
    country: changed.country,
    addressValidationToken: validationToken,
  });

  const recovered = await createMyParcelConceptRecord(created.order.id, {
    client: {
      async findByReference() {
        return [];
      },
      async createConceptShipment(draft) {
        return {
          id: "555777",
          referenceIdentifier: draft.referenceIdentifier,
          statusCode: 1,
          trackingStatus: "concept",
          carrierId: 1,
          barcode: null,
        };
      },
    },
  });
  assert.equal(validated.addressValidationStatus, "valid");
  assert.equal(recovered.shipment.creationStatus, "created");
  const recoveredRows = await sql.query(
    `select creation_status, payload_hash
     from order_shipments where order_id = $1`,
    [created.order.id],
  );
  assert.equal(recoveredRows.length, 1);
  assert.equal(recoveredRows[0].creation_status, "created");
  assert.notEqual(recoveredRows[0].payload_hash, originalPayloadHash);
});

test("MyParcel-fouten blijven bruikbaar en houden hun veilige statuscode", () => {
  for (const status of [400, 409, 503]) {
    const result = resolvePublicServerError(
      new ShipmentActionError("Veilige MyParcel-melding.", status),
      ORDER_SERVER_ERROR_POLICY,
    );
    assert.deepEqual(result, {
      internal: false,
      message: "Veilige MyParcel-melding.",
      status,
    });
  }
});

test("admin bevestigt expliciet vóór de externe A6-labelcall", async () => {
  const source = await readFile("src/routes/admin.tsx", "utf8");
  const confirmIndex = source.indexOf(
    "A6-label bij MyParcel opvragen? Dit is een externe actie.",
  );
  const requestIndex = source.indexOf("await requestMyParcelLabel({");
  assert.ok(confirmIndex >= 0);
  assert.ok(requestIndex > confirmIndex);
  assert.match(source, /shipmentLocksAddress/);
  assert.match(source, /order\.status === "cancelled"/);
  assert.match(source, /order\.status === "shipped"/);
});

test("labelclaim blokkeert dubbele tabs en fulfillment tijdens providercall", async () => {
  const created = await createOrderRecord(orderInput());
  const sql = await getSql();
  await sql.query("update orders set status = 'paid' where id = $1", [
    created.order.id,
  ]);
  const concept = await createMyParcelConceptRecord(created.order.id, {
    client: {
      async findByReference() {
        return [];
      },
      async createConceptShipment(draft) {
        return {
          id: "880001",
          referenceIdentifier: draft.referenceIdentifier,
          statusCode: 1,
          trackingStatus: "concept",
          carrierId: 1,
          barcode: null,
        };
      },
    },
  });
  let releaseLabel;
  let signalLabelStarted;
  const labelStarted = new Promise((resolve) => {
    signalLabelStarted = resolve;
  });
  const waitForLabel = new Promise((resolve) => {
    releaseLabel = resolve;
  });
  const labelClient = {
    async requestLabelLink(id) {
      signalLabelStarted();
      await waitForLabel;
      return {
        shipmentId: id,
        downloadUrl: "https://labels.example.test/atomic-a6.pdf",
      };
    },
  };
  const firstLabel = requestMyParcelLabelRecord(created.order.id, {
    client: labelClient,
  });
  await labelStarted;
  await assert.rejects(
    requestMyParcelLabelRecord(created.order.id, { client: labelClient }),
    /al opgevraagd/i,
  );
  await assert.rejects(
    updateOrderFulfillmentRecord({
      id: created.order.id,
      expectedUpdatedAt: concept.updatedAt,
      lines: [{ slug: "semaglutide-4mg-pen", optionId: "default", qty: 1 }],
    }),
    /vergrendeld|verzending/i,
  );
  releaseLabel();
  const completed = await firstLabel;
  assert.equal(completed.order.shipment.labelStatus, "ready");
  const rows = await sql.query(
    `select label_status from order_shipments where order_id = $1`,
    [created.order.id],
  );
  assert.deepEqual(rows, [{ label_status: "ready" }]);
});

test("actieve labelclaim blokkeert cancelled en shipped zonder netwerk-lock", async () => {
  for (const scenario of [
    { current: "paid", next: "cancelled" },
    { current: "packed", next: "shipped" },
  ]) {
    const created = await createOrderRecord(orderInput());
    const sql = await getSql();
    await sql.query("update orders set status = $1 where id = $2", [
      scenario.current,
      created.order.id,
    ]);
    await createMyParcelConceptRecord(created.order.id, {
      client: {
        async findByReference() {
          return [];
        },
        async createConceptShipment(draft) {
          return {
            id: scenario.next === "shipped" ? "881002" : "881001",
            referenceIdentifier: draft.referenceIdentifier,
            statusCode: 1,
            trackingStatus: "concept",
            carrierId: 1,
            barcode: null,
          };
        },
      },
    });

    let releaseLabel;
    let signalLabelStarted;
    const labelStarted = new Promise((resolve) => {
      signalLabelStarted = resolve;
    });
    const waitForLabel = new Promise((resolve) => {
      releaseLabel = resolve;
    });
    const labelRequest = requestMyParcelLabelRecord(created.order.id, {
      client: {
        async requestLabelLink(id) {
          signalLabelStarted();
          await waitForLabel;
          return {
            shipmentId: id,
            downloadUrl: "https://labels.example.test/status-race-a6.pdf",
          };
        },
      },
    });
    await labelStarted;

    const statusOutcome = Promise.race([
      updateOrderStatusRecord(
        created.order.id,
        scenario.current,
        scenario.next,
      ).then(
        () => ({ kind: "resolved" }),
        (error) => ({ kind: "rejected", error }),
      ),
      new Promise((resolve) =>
        setTimeout(() => resolve({ kind: "timeout" }), 500),
      ),
    ]);
    const outcome = await statusOutcome;
    assert.equal(outcome.kind, "rejected", scenario.next);
    assert.match(outcome.error.message, /intussen gewijzigd/i, scenario.next);

    releaseLabel();
    await labelRequest;
    const updated = await updateOrderStatusRecord(
      created.order.id,
      scenario.current,
      scenario.next,
    );
    assert.equal(updated.status, scenario.next);
  }
});

test("statuswijziging invalideert een verlopen labelclaim vóór late providerresponse", async () => {
  const created = await createOrderRecord(orderInput());
  const sql = await getSql();
  await sql.query("update orders set status = 'paid' where id = $1", [
    created.order.id,
  ]);
  await createMyParcelConceptRecord(created.order.id, {
    client: {
      async findByReference() {
        return [];
      },
      async createConceptShipment(draft) {
        return {
          id: "881003",
          referenceIdentifier: draft.referenceIdentifier,
          statusCode: 1,
          trackingStatus: "concept",
          carrierId: 1,
          barcode: null,
        };
      },
    },
  });

  let releaseLabel;
  let signalLabelStarted;
  const labelStarted = new Promise((resolve) => {
    signalLabelStarted = resolve;
  });
  const waitForLabel = new Promise((resolve) => {
    releaseLabel = resolve;
  });
  const staleClaimTime = new Date(Date.now() - 3 * 60 * 1_000);
  const labelRequest = requestMyParcelLabelRecord(created.order.id, {
    now: () => staleClaimTime,
    client: {
      async requestLabelLink(id) {
        signalLabelStarted();
        await waitForLabel;
        return {
          shipmentId: id,
          downloadUrl: "https://labels.example.test/late-stale-a6.pdf",
        };
      },
    },
  });
  await labelStarted;

  const cancelled = await updateOrderStatusRecord(
    created.order.id,
    "paid",
    "cancelled",
  );
  assert.equal(cancelled.status, "cancelled");
  releaseLabel();
  await assert.rejects(labelRequest, /nieuwere actie vervangen/i);
  const rows = await sql.query(
    `select label_status, label_requested_at
     from order_shipments where order_id = $1`,
    [created.order.id],
  );
  assert.equal(rows[0].label_status, "failed");
  assert.equal(rows[0].label_requested_at, null);
});

test("late fout van verlopen labelclaim overschrijft nieuw ready-label niet", async () => {
  const created = await createOrderRecord(orderInput());
  const sql = await getSql();
  await sql.query("update orders set status = 'paid' where id = $1", [
    created.order.id,
  ]);
  await createMyParcelConceptRecord(created.order.id, {
    client: {
      async findByReference() {
        return [];
      },
      async createConceptShipment(draft) {
        return {
          id: "880003",
          referenceIdentifier: draft.referenceIdentifier,
          statusCode: 1,
          trackingStatus: "concept",
          carrierId: 1,
          barcode: null,
        };
      },
    },
  });
  let clock = new Date("2026-08-20T10:00:00.000Z");
  let rejectOldLabel;
  let signalOldStarted;
  const oldStarted = new Promise((resolve) => {
    signalOldStarted = resolve;
  });
  const oldResult = new Promise((_, reject) => {
    rejectOldLabel = reject;
  });
  let labelCalls = 0;
  const client = {
    async requestLabelLink(id) {
      labelCalls += 1;
      if (labelCalls === 1) {
        signalOldStarted();
        return oldResult;
      }
      return {
        shipmentId: id,
        downloadUrl: "https://labels.example.test/new-ready-a6.pdf",
      };
    },
  };
  const oldRequest = requestMyParcelLabelRecord(created.order.id, {
    client,
    now: () => clock,
  });
  await oldStarted;
  clock = new Date("2026-08-20T10:03:00.000Z");
  const replacement = await requestMyParcelLabelRecord(created.order.id, {
    client,
    now: () => clock,
  });
  assert.equal(replacement.order.shipment.labelStatus, "ready");
  rejectOldLabel(new Error("late provider failure"));
  await assert.rejects(oldRequest, /late provider failure/);
  const rows = await sql.query(
    `select label_status, label_requested_at
     from order_shipments where order_id = $1`,
    [created.order.id],
  );
  assert.equal(rows[0].label_status, "ready");
  assert.equal(
    new Date(rows[0].label_requested_at).toISOString(),
    clock.toISOString(),
  );
});

test("trackingrefresh serialiseert vóór fulfillment en laat carrierlock winnen", async () => {
  const created = await createOrderRecord(orderInput());
  const sql = await getSql();
  await sql.query("update orders set status = 'paid' where id = $1", [
    created.order.id,
  ]);
  const concept = await createMyParcelConceptRecord(created.order.id, {
    client: {
      async findByReference() {
        return [];
      },
      async createConceptShipment(draft) {
        return {
          id: "880002",
          referenceIdentifier: draft.referenceIdentifier,
          statusCode: 1,
          trackingStatus: "concept",
          carrierId: 1,
          barcode: null,
        };
      },
    },
  });
  let releaseTracking;
  let signalTrackingStarted;
  const trackingStarted = new Promise((resolve) => {
    signalTrackingStarted = resolve;
  });
  const waitForTracking = new Promise((resolve) => {
    releaseTracking = resolve;
  });
  const refresh = refreshMyParcelTrackingRecord(created.order.id, {
    client: {
      async getTracking(id) {
        signalTrackingStarted();
        await waitForTracking;
        return {
          shipmentId: id,
          providerStatusCode: 5,
          status: "in_transit",
          barcode: "3SATOMIC880002",
          trackingUrl: "https://tracking.example.test/3SATOMIC880002",
          delayed: false,
          final: false,
        };
      },
    },
  });
  await trackingStarted;
  const fulfillment = updateOrderFulfillmentRecord({
    id: created.order.id,
    expectedUpdatedAt: concept.updatedAt,
    lines: [{ slug: "semaglutide-4mg-pen", optionId: "default", qty: 1 }],
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  releaseTracking();
  await refresh;
  await assert.rejects(fulfillment, /vergrendeld|verzending/i);
});

test("labelopvraag wordt server-side geblokkeerd na shipped of cancelled", async () => {
  const sql = await getSql();
  for (const status of ["shipped", "cancelled"]) {
    const created = await createOrderRecord(orderInput());
    await sql.query("update orders set status = 'paid' where id = $1", [
      created.order.id,
    ]);
    await createMyParcelConceptRecord(created.order.id, {
      client: {
        async findByReference() {
          return [];
        },
        async createConceptShipment(draft) {
          return {
            id: status === "shipped" ? "990001" : "990002",
            referenceIdentifier: draft.referenceIdentifier,
            statusCode: 1,
            trackingStatus: "concept",
            carrierId: 1,
            barcode: null,
          };
        },
      },
    });
    await sql.query("update orders set status = $1 where id = $2", [
      status,
      created.order.id,
    ]);
    let providerCalls = 0;
    await assert.rejects(
      requestMyParcelLabelRecord(created.order.id, {
        client: {
          async requestLabelLink() {
            providerCalls += 1;
          },
        },
      }),
      /verzonden of geannuleerde/i,
    );
    assert.equal(providerCalls, 0);
  }
});

test("MyParcel concept, A6-label en tracking blijven aparte gemockte acties", async () => {
  const created = await createOrderRecord(orderInput());
  const sql = await getSql();
  await sql.query("update orders set status = 'paid' where id = $1", [
    created.order.id,
  ]);

  const calls = [];
  const client = {
    async findByReference(reference) {
      calls.push(["find", reference]);
      return [];
    },
    async createConceptShipment(draft) {
      calls.push(["create", draft]);
      return {
        id: "987654",
        referenceIdentifier: draft.referenceIdentifier,
        statusCode: 1,
        trackingStatus: "concept",
        carrierId: 1,
        barcode: null,
      };
    },
    async requestLabelLink(id, format) {
      calls.push(["label", id, format]);
      return {
        shipmentId: id,
        downloadUrl: "https://labels.example.test/a6.pdf",
      };
    },
    async getTracking(id) {
      calls.push(["tracking", id]);
      return {
        shipmentId: id,
        providerStatusCode: 5,
        status: "in_transit",
        barcode: "3STEST987654",
        trackingUrl: "https://tracking.example.test/3STEST987654",
        delayed: false,
        final: false,
      };
    },
  };

  const first = await createMyParcelConceptRecord(created.order.id, { client });
  assert.equal(first.shipment.creationStatus, "created");
  assert.equal(first.shipment.providerShipmentId, "987654");
  const callCount = calls.length;
  const replay = await createMyParcelConceptRecord(created.order.id, {
    client,
  });
  assert.equal(replay.shipment.providerShipmentId, "987654");
  assert.equal(
    calls.length,
    callCount,
    "replay mag MyParcel niet opnieuw aanroepen",
  );

  const label = await requestMyParcelLabelRecord(created.order.id, { client });
  assert.equal(label.downloadUrl, "https://labels.example.test/a6.pdf");
  assert.deepEqual(calls.at(-1), ["label", "987654", "A6"]);
  assert.equal(label.order.shipment.labelStatus, "ready");

  const refreshed = await refreshMyParcelTrackingRecord(created.order.id, {
    client,
  });
  assert.equal(refreshed.shipment.trackingStatus, "in_transit");
  assert.equal(refreshed.shipment.barcode, "3STEST987654");

  const publicOrder = await getOrderRecordForViewer({
    id: created.order.id,
    isAdmin: true,
  });
  assert.deepEqual(publicOrder.tracking, {
    barcode: "3STEST987654",
    trackingUrl: "https://tracking.example.test/3STEST987654",
    trackingStatus: "in_transit",
    lastSyncedAt: refreshed.shipment.lastSyncedAt,
  });

  const events = await sql.query(
    `select event_type from order_events
     where order_id = $1 and event_type like 'shipment_%'
     order by event_type`,
    [created.order.id],
  );
  assert.deepEqual(events, [
    { event_type: "shipment_created" },
    { event_type: "shipment_tracking_changed" },
  ]);
});
