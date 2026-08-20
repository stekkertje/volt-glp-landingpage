import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let vite;
let createAddressValidationService;
let addressValidationFingerprint;
let createIdempotentShipmentService;
let createMyParcelClient;
let IntegrationError;
let mapMyParcelStatus;
let createSqlShipmentCreationRepository;
let getSql;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

before(async () => {
  vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ createAddressValidationService, addressValidationFingerprint } =
    await vite.ssrLoadModule(
      "/src/lib/server/integrations/address-validation.server.ts",
    ));
  ({
    createIdempotentShipmentService,
    createMyParcelClient,
    mapMyParcelStatus,
  } = await vite.ssrLoadModule(
    "/src/lib/server/integrations/myparcel.server.ts",
  ));
  ({ IntegrationError } = await vite.ssrLoadModule(
    "/src/lib/server/integrations/integration-error.ts",
  ));
  ({ createSqlShipmentCreationRepository } = await vite.ssrLoadModule(
    "/src/lib/server/integrations/shipment-repository.server.ts",
  ));
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
});

after(async () => {
  await vite?.close();
});

test("Nederlandse adressen gebruiken ApiCheck zonder sleutel in URL of body", async () => {
  let seen;
  const service = createAddressValidationService({
    apiCheckApiKey: "apicheck-test-secret",
    googleApiKey: "google-test-secret",
    transport: async (input, init) => {
      seen = { url: String(input), init };
      return jsonResponse({
        error: false,
        data: {
          street: "Koninklijk Park",
          number: "1",
          numberAddition: "A",
          postalcode: "7315 JA",
          city: "Apeldoorn",
          formattedAddress: "Koninklijk Park 1 A, 7315 JA Apeldoorn",
        },
      });
    },
  });
  const result = await service.validate({
    street: "Koninklijk Park",
    houseNumber: "1 A",
    postcode: "7315JA",
    city: "Apeldoorn",
    country: "nl",
  });

  assert.equal(result.status, "valid");
  assert.equal(result.provider, "apicheck");
  assert.equal(result.normalizedAddress.postcode, "7315 JA");
  assert.deepEqual(result.changedFields, []);
  assert.match(seen.url, /\/lookup\/v1\/address\/nl\?/);
  assert.match(seen.url, /postalcode=7315JA/);
  assert.doesNotMatch(seen.url, /apicheck-test-secret/);
  assert.equal(
    new Headers(seen.init.headers).get("X-API-KEY"),
    "apicheck-test-secret",
  );
  assert.equal(seen.init.body, undefined);
});

test("adresfingerprint is stabiel over onbetekenende schrijfverschillen", () => {
  const first = addressValidationFingerprint({
    street: "Koninklijk Park",
    houseNumber: "1 A",
    postcode: "7315 JA",
    city: "Apeldoorn",
    country: "NL",
  });
  const second = addressValidationFingerprint({
    street: "  koninklijk-park ",
    houseNumber: "1a",
    postcode: "7315ja",
    city: "APELDOORN",
    country: "nl",
  });
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(
    addressValidationFingerprint({
      street: "Koninklijk Park",
      houseNumber: "1-2",
      postcode: "7315 JA",
      city: "Apeldoorn",
      country: "NL",
    }),
    addressValidationFingerprint({
      street: "Koninklijk Park",
      houseNumber: "12",
      postcode: "7315 JA",
      city: "Apeldoorn",
      country: "NL",
    }),
  );
});

test("ApiCheck-correcties worden niet stil toegepast maar vragen bevestiging", async () => {
  const service = createAddressValidationService({
    apiCheckApiKey: "test",
    transport: async () =>
      jsonResponse({
        error: false,
        data: {
          street: "Koninklijk Park",
          number: "1",
          numberAddition: null,
          postalcode: "7315 JA",
          city: "Apeldoorn",
        },
      }),
  });
  const result = await service.validate({
    street: "Koningspark",
    houseNumber: "1",
    postcode: "7315 JA",
    city: "Apeldoorn",
    country: "NL",
  });
  assert.equal(result.status, "needs_confirmation");
  assert.deepEqual(result.changedFields, ["street"]);
  assert.equal(result.normalizedAddress.street, "Koninklijk Park");
});

test("ApiCheck 404 is een ongeldig adres en geen tijdelijke storing", async () => {
  const service = createAddressValidationService({
    apiCheckApiKey: "test",
    transport: async () => jsonResponse({ error: true, name: "no_match" }, 404),
  });
  const result = await service.validate({
    street: "Onbekend",
    houseNumber: "999",
    postcode: "1234 AB",
    city: "Utrecht",
    country: "NL",
  });
  assert.equal(result.status, "invalid");
  assert.equal(result.issue, "not_found");
  assert.equal(result.retryable, false);
});

test("overige EU-adressen gebruiken Google server-side en houden de sleutel uit de URL", async () => {
  let seen;
  const service = createAddressValidationService({
    apiCheckApiKey: "apicheck-test-secret",
    googleApiKey: "google-test-secret",
    transport: async (input, init) => {
      seen = { url: String(input), init };
      return jsonResponse({
        result: {
          verdict: {
            addressComplete: true,
            hasUnconfirmedComponents: false,
            possibleNextAction: "ACCEPT",
          },
          address: {
            formattedAddress: "Wetstraat 200, 1049 Brussel, België",
            postalAddress: {
              regionCode: "BE",
              postalCode: "1049",
              locality: "Brussel",
              addressLines: ["Wetstraat 200"],
            },
            addressComponents: [
              {
                componentType: "route",
                componentName: { text: "Wetstraat" },
                confirmationLevel: "CONFIRMED",
              },
              {
                componentType: "street_number",
                componentName: { text: "200" },
                confirmationLevel: "CONFIRMED",
              },
            ],
            missingComponentTypes: [],
            unconfirmedComponentTypes: [],
          },
        },
      });
    },
  });
  const result = await service.validate({
    street: "Wetstraat",
    houseNumber: "200",
    postcode: "1049",
    city: "Brussel",
    country: "BE",
  });

  assert.equal(result.status, "valid");
  assert.equal(result.provider, "google");
  assert.equal(
    seen.url,
    "https://addressvalidation.googleapis.com/v1:validateAddress",
  );
  assert.doesNotMatch(seen.url, /google-test-secret/);
  assert.equal(
    new Headers(seen.init.headers).get("X-Goog-Api-Key"),
    "google-test-secret",
  );
  const sent = JSON.parse(seen.init.body);
  assert.equal(sent.address.regionCode, "BE");
  assert.equal(JSON.stringify(sent).includes("google-test-secret"), false);
});

test("Google ontbrekende componenten blokkeren checkout-validatie", async () => {
  const service = createAddressValidationService({
    googleApiKey: "test",
    transport: async () =>
      jsonResponse({
        result: {
          verdict: {
            addressComplete: false,
            possibleNextAction: "FIX",
          },
          address: {
            formattedAddress: "Wetstraat, Brussel",
            postalAddress: {
              regionCode: "BE",
              postalCode: "1049",
              locality: "Brussel",
              addressLines: ["Wetstraat"],
            },
            addressComponents: [
              {
                componentType: "route",
                componentName: { text: "Wetstraat" },
              },
            ],
            missingComponentTypes: ["street_number"],
          },
        },
      }),
  });
  const result = await service.validate({
    street: "Wetstraat",
    houseNumber: "200",
    postcode: "1049",
    city: "Brussel",
    country: "BE",
  });
  assert.equal(result.status, "invalid");
  assert.equal(result.issue, "missing_component");
});

test("niet-EU-landen doen geen externe API-aanroep", async () => {
  let calls = 0;
  const service = createAddressValidationService({
    apiCheckApiKey: "test",
    googleApiKey: "test",
    transport: async () => {
      calls += 1;
      throw new Error("unexpected");
    },
  });
  const result = await service.validate({
    street: "Main Street",
    houseNumber: "1",
    postcode: "10001",
    city: "New York",
    country: "US",
  });
  assert.equal(result.status, "unsupported_country");
  assert.equal(calls, 0);
});

test("provider-timeouts worden veilig en retrybaar gemapt", async () => {
  const service = createAddressValidationService({
    apiCheckApiKey: "test",
    timeoutMs: 5,
    transport: (_input, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      }),
  });
  const result = await service.validate({
    street: "Koninklijk Park",
    houseNumber: "1",
    postcode: "7315 JA",
    city: "Apeldoorn",
    country: "NL",
  });
  assert.equal(result.status, "unavailable");
  assert.equal(result.issue, "provider_error");
  assert.equal(result.retryable, true);
});

test("MyParcel-lookup gebruikt exacte referentie en lekt de sleutel nergens", async () => {
  let seen;
  const client = createMyParcelClient({
    apiKey: "myparcel-test-secret",
    transport: async (input, init) => {
      seen = { url: String(input), init };
      return jsonResponse({
        data: {
          search_results: {
            shipments: [
              {
                id: 123,
                reference_identifier: "MED-3100",
                status: 2,
                carrier_id: 1,
                barcode: "3STEST123",
              },
              {
                id: 456,
                reference_identifier: "MED-31000",
                status: 2,
              },
            ],
          },
        },
      });
    },
  });
  const results = await client.findByReference("MED-3100");
  assert.equal(results.length, 1);
  assert.equal(results[0].id, "123");
  assert.equal(results[0].trackingStatus, "registered");
  assert.match(seen.url, /reference_identifier=MED-3100/);
  assert.doesNotMatch(seen.url, /myparcel-test-secret/);
  assert.equal(seen.init.body, undefined);
  const authorization = new Headers(seen.init.headers).get("Authorization");
  assert.equal(
    authorization,
    `Basic ${Buffer.from("myparcel-test-secret", "utf8").toString("base64")}`,
  );
  assert.equal(authorization.includes("myparcel-test-secret"), false);
});

test("MyParcel maakt eerst alleen een concept en genereert niet stil een label", async () => {
  let seen;
  const client = createMyParcelClient({
    apiKey: "test-key",
    transport: async (input, init) => {
      seen = { url: String(input), init };
      return jsonResponse({
        data: { ids: [{ id: 789, reference_identifier: "MED-3102" }] },
      });
    },
  });
  const result = await client.createConceptShipment({
    referenceIdentifier: "MED-3102",
    recipient: {
      country: "NL",
      city: "Apeldoorn",
      street: "Koninklijk Park",
      houseNumber: "1",
      houseNumberAddition: "A",
      postcode: "7315 JA",
      person: "Test Ontvanger",
      email: "ontvanger@example.test",
    },
  });
  assert.equal(result.id, "789");
  assert.equal(result.trackingStatus, "concept");
  assert.equal(seen.url, "https://api.myparcel.nl/shipments");
  assert.equal(seen.init.method, "POST");
  assert.equal(
    new Headers(seen.init.headers).get("Accept"),
    "application/json;charset=utf-8",
  );
  const sent = JSON.parse(seen.init.body).data.shipments[0];
  assert.equal(sent.reference_identifier, "MED-3102");
  assert.equal(sent.recipient.number_suffix, "A");
  assert.equal(sent.recipient.postal_code, "7315JA");
  assert.equal(sent.options.package_type, 1);
});

test("labelopvraag en tracking zijn losse expliciete operaties", async () => {
  const requests = [];
  const client = createMyParcelClient({
    apiKey: "test-key",
    transport: async (input, init) => {
      requests.push({ url: String(input), init });
      if (String(input).includes("shipment_labels")) {
        return jsonResponse({
          data: {
            pdfs: { url: "https://api.myparcel.nl/pdfs/test-label-token" },
          },
        });
      }
      return jsonResponse({
        data: {
          tracktraces: [
            {
              shipment_id: 789,
              barcode: "3STEST789",
              link_consumer_portal:
                "https://volt.myparcel.me/track-trace/3STEST789/7315JA/NL",
              delayed: false,
              status: { current: 5, main: "distribution", final: false },
            },
          ],
        },
      });
    },
  });
  const label = await client.requestLabelLink("789");
  const tracking = await client.getTracking("789");

  assert.equal(
    label.downloadUrl,
    "https://api.myparcel.nl/pdfs/test-label-token",
  );
  assert.equal(tracking.status, "in_transit");
  assert.equal(tracking.barcode, "3STEST789");
  assert.equal(
    tracking.trackingUrl,
    "https://volt.myparcel.me/track-trace/3STEST789/7315JA/NL",
  );
  assert.match(requests[0].url, /shipment_labels\/789\?format=A6$/);
  assert.match(requests[1].url, /tracktraces\/789$/);
  for (const request of requests) {
    const authorization = new Headers(request.init.headers).get(
      "Authorization",
    );
    assert.equal(
      authorization,
      `Basic ${Buffer.from("test-key", "utf8").toString("base64")}`,
    );
    assert.equal(String(request.url).includes("test-key"), false);
    assert.equal(String(request.init.body ?? "").includes("test-key"), false);
  }
});

test("MyParcel-statussen hebben een stabiele klantstatusmapping", () => {
  assert.equal(mapMyParcelStatus(1), "concept");
  assert.equal(mapMyParcelStatus(2), "registered");
  assert.equal(mapMyParcelStatus(3), "handed_over");
  assert.equal(mapMyParcelStatus(5), "in_transit");
  assert.equal(mapMyParcelStatus(8), "in_transit");
  assert.equal(mapMyParcelStatus(7), "delivered");
  assert.equal(mapMyParcelStatus(11), "returned");
  assert.equal(mapMyParcelStatus(13), "exception");
  assert.equal(mapMyParcelStatus(17), "exception");
  assert.equal(mapMyParcelStatus(999), "unknown");
  assert.equal(mapMyParcelStatus(5, "delivered"), "delivered");
});

function repositoryReturning(claim) {
  const calls = [];
  return {
    calls,
    async claim(value) {
      calls.push(["claim", value]);
      return claim;
    },
    async complete(value) {
      calls.push(["complete", value]);
    },
    async markAmbiguous(value) {
      calls.push(["ambiguous", value]);
    },
    async markFailed(value) {
      calls.push(["failed", value]);
    },
  };
}

function shipmentDraft() {
  return {
    referenceIdentifier: "MED-3110",
    recipient: {
      country: "NL",
      city: "Apeldoorn",
      street: "Koninklijk Park",
      houseNumber: "1",
      postcode: "7315 JA",
      person: "Test Ontvanger",
      email: "ontvanger@example.test",
    },
  };
}

test("idempotente service adopteert een remote zending vóór een nieuwe POST", async () => {
  const repository = repositoryReturning({
    kind: "claimed",
    token: "claim",
    reconcileOnly: false,
  });
  let creates = 0;
  const remote = {
    id: "123",
    referenceIdentifier: "MED-3110",
    statusCode: 2,
    trackingStatus: "registered",
    carrierId: 1,
    barcode: "3STEST123",
  };
  const service = createIdempotentShipmentService({
    repository,
    client: {
      async findByReference() {
        return [remote];
      },
      async createConceptShipment() {
        creates += 1;
        throw new Error("should-not-create");
      },
    },
    now: () => new Date("2026-08-20T10:00:00Z"),
  });
  const result = await service.ensureShipment({
    orderId: "order-1",
    idempotencyKey: "ship-order-1-v1",
    draft: shipmentDraft(),
  });
  assert.equal(result.kind, "created_or_reconciled");
  assert.equal(result.shipment.id, "123");
  assert.equal(creates, 0);
  assert.equal(repository.calls[1][0], "complete");
});

test("tijdelijke lookupfout vóór de eerste POST blijft veilig opnieuw POST-eligible", async () => {
  let claimCount = 0;
  const calls = [];
  const repository = {
    async claim() {
      claimCount += 1;
      return {
        kind: "claimed",
        token: `claim-${claimCount}`,
        reconcileOnly: false,
      };
    },
    async complete(value) {
      calls.push(["complete", value]);
    },
    async markAmbiguous(value) {
      calls.push(["ambiguous", value]);
    },
    async markFailed(value) {
      calls.push(["failed", value]);
    },
  };
  let lookups = 0;
  let creates = 0;
  const service = createIdempotentShipmentService({
    repository,
    client: {
      async findByReference() {
        lookups += 1;
        if (lookups === 1) {
          throw new IntegrationError({
            provider: "myparcel",
            code: "timeout",
            retryable: true,
          });
        }
        return [];
      },
      async createConceptShipment(draft) {
        creates += 1;
        return {
          id: "123",
          referenceIdentifier: draft.referenceIdentifier,
          statusCode: 1,
          trackingStatus: "concept",
          carrierId: 1,
          barcode: null,
        };
      },
    },
  });
  const request = {
    orderId: "order-1",
    idempotencyKey: "ship-order-1-v1",
    draft: shipmentDraft(),
  };
  await assert.rejects(service.ensureShipment(request), /myparcel:timeout/);
  assert.equal(creates, 0);
  assert.equal(calls.at(-1)[0], "failed");

  const result = await service.ensureShipment(request);
  assert.equal(result.kind, "created_or_reconciled");
  assert.equal(creates, 1);
  assert.deepEqual(
    calls.map(([kind]) => kind),
    ["failed", "complete"],
  );
});

test("ongeldige 2xx-response na concept-POST blijft ambiguous", async () => {
  const repository = repositoryReturning({
    kind: "claimed",
    token: "claim",
    reconcileOnly: false,
  });
  const service = createIdempotentShipmentService({
    repository,
    client: {
      async findByReference() {
        return [];
      },
      async createConceptShipment() {
        throw new IntegrationError({
          provider: "myparcel",
          code: "invalid_response",
          retryable: false,
          httpStatus: 200,
        });
      },
    },
  });
  await assert.rejects(
    service.ensureShipment({
      orderId: "order-1",
      idempotencyKey: "ship-order-1-v1",
      draft: shipmentDraft(),
    }),
    /myparcel:invalid_response/,
  );
  assert.equal(repository.calls.at(-1)[0], "ambiguous");
});

test("een onzekere concept-POST wordt alleen gereconcilieerd en nooit opnieuw gepost", async () => {
  let claimCount = 0;
  const calls = [];
  const repository = {
    async claim() {
      claimCount += 1;
      return {
        kind: "claimed",
        token: `claim-${claimCount}`,
        reconcileOnly: claimCount > 1,
      };
    },
    async complete(value) {
      calls.push(["complete", value]);
    },
    async markAmbiguous(value) {
      calls.push(["ambiguous", value]);
    },
    async markFailed(value) {
      calls.push(["failed", value]);
    },
  };
  let creates = 0;
  const service = createIdempotentShipmentService({
    repository,
    client: {
      async findByReference() {
        return [];
      },
      async createConceptShipment() {
        creates += 1;
        throw new IntegrationError({
          provider: "myparcel",
          code: "timeout",
          retryable: true,
        });
      },
    },
  });
  const request = {
    orderId: "order-1",
    idempotencyKey: "ship-order-1-v1",
    draft: shipmentDraft(),
  };

  await assert.rejects(service.ensureShipment(request), /myparcel:timeout/);
  await assert.rejects(
    service.ensureShipment(request),
    /eerdere MyParcel-aanvraag is nog onzeker/i,
  );
  assert.equal(creates, 1);
  assert.deepEqual(
    calls.map(([kind]) => kind),
    ["ambiguous", "ambiguous"],
  );
});

test("nonretryable reconciliatiefout maakt een onzekere POST nooit opnieuw POST-eligible", async () => {
  let claimCount = 0;
  const calls = [];
  const repository = {
    async claim() {
      claimCount += 1;
      return {
        kind: "claimed",
        token: `claim-${claimCount}`,
        reconcileOnly: claimCount > 1,
      };
    },
    async complete(value) {
      calls.push(["complete", value]);
    },
    async markAmbiguous(value) {
      calls.push(["ambiguous", value]);
    },
    async markFailed(value) {
      calls.push(["failed", value]);
    },
  };
  let lookups = 0;
  let creates = 0;
  const service = createIdempotentShipmentService({
    repository,
    client: {
      async findByReference() {
        lookups += 1;
        if (lookups === 1) return [];
        throw new IntegrationError({
          provider: "myparcel",
          code: "unauthorized",
          retryable: false,
          httpStatus: 401,
        });
      },
      async createConceptShipment() {
        creates += 1;
        throw new IntegrationError({
          provider: "myparcel",
          code: "timeout",
          retryable: true,
        });
      },
    },
  });
  const request = {
    orderId: "order-1",
    idempotencyKey: "ship-order-1-v1",
    draft: shipmentDraft(),
  };

  await assert.rejects(service.ensureShipment(request), /myparcel:timeout/);
  await assert.rejects(
    service.ensureShipment(request),
    /myparcel:unauthorized/,
  );
  assert.equal(creates, 1);
  assert.deepEqual(
    calls.map(([kind]) => kind),
    ["ambiguous", "ambiguous"],
  );
});

test("een DB-fout na de concept-POST blijft ambiguous", async () => {
  const repository = repositoryReturning({
    kind: "claimed",
    token: "claim",
    reconcileOnly: false,
  });
  repository.complete = async (value) => {
    repository.calls.push(["complete", value]);
    throw new Error("databaseverbinding weg na providerresponse");
  };
  const service = createIdempotentShipmentService({
    repository,
    client: {
      async findByReference() {
        return [];
      },
      async createConceptShipment() {
        return {
          id: "123",
          referenceIdentifier: "MED-3110",
          statusCode: 1,
          trackingStatus: "concept",
          carrierId: 1,
          barcode: null,
        };
      },
    },
  });

  await assert.rejects(
    service.ensureShipment({
      orderId: "order-1",
      idempotencyKey: "ship-order-1-v1",
      draft: shipmentDraft(),
    }),
    /databaseverbinding weg/,
  );
  assert.equal(repository.calls.at(-1)[0], "ambiguous");
  assert.equal(
    repository.calls.some(([kind]) => kind === "failed"),
    false,
  );
});

test("een DB-fout na gevonden remote shipment blijft reconcile-only", async () => {
  const repository = repositoryReturning({
    kind: "claimed",
    token: "claim",
    reconcileOnly: false,
  });
  repository.complete = async (value) => {
    repository.calls.push(["complete", value]);
    throw new Error("databaseverbinding weg na reconciliatie");
  };
  const service = createIdempotentShipmentService({
    repository,
    client: {
      async findByReference() {
        return [
          {
            id: "123",
            referenceIdentifier: "MED-3110",
            statusCode: 1,
            trackingStatus: "concept",
            carrierId: 1,
            barcode: null,
          },
        ];
      },
      async createConceptShipment() {
        throw new Error("should-not-create");
      },
    },
  });

  await assert.rejects(
    service.ensureShipment({
      orderId: "order-1",
      idempotencyKey: "ship-order-1-v1",
      draft: shipmentDraft(),
    }),
    /databaseverbinding weg na reconciliatie/,
  );
  assert.equal(repository.calls.at(-1)[0], "ambiguous");
});

test("bestaande afgeronde claim veroorzaakt geen externe API-aanroep", async () => {
  const record = {
    orderId: "order-1",
    referenceIdentifier: "MED-3110",
    idempotencyKey: "ship-order-1-v1",
    payloadHash: "hash",
    state: "created",
    providerShipmentId: "123",
  };
  const repository = repositoryReturning({ kind: "existing", record });
  let calls = 0;
  const service = createIdempotentShipmentService({
    repository,
    client: {
      async findByReference() {
        calls += 1;
      },
      async createConceptShipment() {
        calls += 1;
      },
    },
  });
  const result = await service.ensureShipment({
    orderId: "order-1",
    idempotencyKey: "ship-order-1-v1",
    draft: shipmentDraft(),
  });
  assert.deepEqual(result, { kind: "existing", record });
  assert.equal(calls, 0);
});

test("SQL shipment-repository claimt atomair, blokkeert dubbels en bewaart voltooiing", async () => {
  const sql = await getSql();
  const orderId = randomUUID();
  const customerId = randomUUID();
  const orderNumber = `MED-${Math.floor(Math.random() * 1_000_000)}`;
  await sql.query(
    `insert into customers (id, email, name)
     values ($1, $2, $3)`,
    [customerId, `${orderId}@example.test`, "Test Ontvanger"],
  );
  await sql.query(
    `insert into orders (
       id, order_number, customer_id, email, name, street, house_number,
       postcode, city, country, status, subtotal_cents, stack_discount_cents,
       code_discount_cents, shipping_cents, total_cents
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'NL', 'paid', 1000, 0, 0, 0, 1000)`,
    [
      orderId,
      orderNumber,
      customerId,
      `${orderId}@example.test`,
      "Test Ontvanger",
      "Koninklijk Park",
      "1",
      "7315 JA",
      "Apeldoorn",
    ],
  );

  let clock = new Date("2026-08-20T10:00:00Z");
  const repository = createSqlShipmentCreationRepository({ now: () => clock });
  const first = await repository.claim({
    orderId,
    referenceIdentifier: orderNumber,
    idempotencyKey: `shipment:${orderId}:v1`,
    payloadHash: "a".repeat(64),
    claimToken: "claim-one",
    claimExpiresAt: new Date("2026-08-20T10:01:00Z"),
  });
  assert.deepEqual(first, {
    kind: "claimed",
    token: "claim-one",
    reconcileOnly: false,
  });

  const concurrent = await repository.claim({
    orderId,
    referenceIdentifier: orderNumber,
    idempotencyKey: `shipment:${orderId}:v1`,
    payloadHash: "a".repeat(64),
    claimToken: "claim-two",
    claimExpiresAt: new Date("2026-08-20T10:01:00Z"),
  });
  assert.deepEqual(concurrent, { kind: "busy" });

  const conflict = await repository.claim({
    orderId,
    referenceIdentifier: orderNumber,
    idempotencyKey: `shipment:${orderId}:v1`,
    payloadHash: "b".repeat(64),
    claimToken: "claim-two",
    claimExpiresAt: new Date("2026-08-20T10:01:00Z"),
  });
  assert.deepEqual(conflict, { kind: "conflict" });

  clock = new Date("2026-08-20T10:02:00Z");
  const reclaimed = await repository.claim({
    orderId,
    referenceIdentifier: orderNumber,
    idempotencyKey: `shipment:${orderId}:v1`,
    payloadHash: "a".repeat(64),
    claimToken: "claim-three",
    claimExpiresAt: new Date("2026-08-20T10:03:00Z"),
  });
  assert.deepEqual(reclaimed, {
    kind: "claimed",
    token: "claim-three",
    reconcileOnly: true,
  });

  await repository.complete({
    orderId,
    claimToken: "claim-three",
    shipment: {
      id: "987654",
      referenceIdentifier: orderNumber,
      statusCode: 1,
      trackingStatus: "concept",
      carrierId: 1,
      barcode: null,
    },
  });
  const existing = await repository.claim({
    orderId,
    referenceIdentifier: orderNumber,
    idempotencyKey: `shipment:${orderId}:v1`,
    payloadHash: "a".repeat(64),
    claimToken: "claim-four",
    claimExpiresAt: new Date("2026-08-20T10:04:00Z"),
  });
  assert.equal(existing.kind, "existing");
  assert.equal(existing.record.providerShipmentId, "987654");
  assert.equal(existing.record.state, "created");
});

test("SQL shipment-state onderscheidt veilige lookupretry van permanent ambiguous", async () => {
  const sql = await getSql();
  const orderId = randomUUID();
  const customerId = randomUUID();
  const orderNumber = `MED-${Math.floor(Math.random() * 1_000_000)}`;
  await sql.query(
    `insert into customers (id, email, name)
     values ($1, $2, $3)`,
    [customerId, `${orderId}@example.test`, "Test Ontvanger"],
  );
  await sql.query(
    `insert into orders (
       id, order_number, customer_id, email, name, street, house_number,
       postcode, city, country, status, subtotal_cents, stack_discount_cents,
       code_discount_cents, shipping_cents, total_cents
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'NL', 'paid', 1000, 0, 0, 0, 1000)`,
    [
      orderId,
      orderNumber,
      customerId,
      `${orderId}@example.test`,
      "Test Ontvanger",
      "Koninklijk Park",
      "1",
      "7315 JA",
      "Apeldoorn",
    ],
  );

  const repository = createSqlShipmentCreationRepository({
    now: () => new Date("2026-08-20T10:00:00Z"),
  });
  const claimInput = {
    orderId,
    referenceIdentifier: orderNumber,
    idempotencyKey: `shipment:${orderId}:v1`,
    payloadHash: "c".repeat(64),
    claimExpiresAt: new Date("2026-08-20T10:01:00Z"),
  };

  const lookupClaim = await repository.claim({
    ...claimInput,
    claimToken: "lookup-claim",
  });
  assert.equal(lookupClaim.kind, "claimed");
  assert.equal(lookupClaim.reconcileOnly, false);
  await repository.markFailed({ orderId, claimToken: "lookup-claim" });

  const postClaim = await repository.claim({
    ...claimInput,
    claimToken: "post-claim",
  });
  assert.equal(postClaim.kind, "claimed");
  assert.equal(postClaim.reconcileOnly, false);
  await repository.markAmbiguous({ orderId, claimToken: "post-claim" });

  const reconcileClaim = await repository.claim({
    ...claimInput,
    claimToken: "reconcile-claim",
  });
  assert.equal(reconcileClaim.kind, "claimed");
  assert.equal(reconcileClaim.reconcileOnly, true);
  const activeRows = await sql.query(
    `select creation_status from order_shipments where order_id = $1`,
    [orderId],
  );
  assert.equal(activeRows[0].creation_status, "ambiguous");

  // Even an erroneous failure transition cannot downgrade an ambiguous POST.
  await repository.markFailed({ orderId, claimToken: "reconcile-claim" });
  const protectedRows = await sql.query(
    `select creation_status from order_shipments where order_id = $1`,
    [orderId],
  );
  assert.equal(protectedRows[0].creation_status, "ambiguous");
  await repository.markAmbiguous({ orderId, claimToken: "reconcile-claim" });

  const laterReconcile = await repository.claim({
    ...claimInput,
    claimToken: "later-reconcile",
  });
  assert.equal(laterReconcile.kind, "claimed");
  assert.equal(laterReconcile.reconcileOnly, true);
});
