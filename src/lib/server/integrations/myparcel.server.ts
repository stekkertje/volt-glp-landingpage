import { createHash, randomUUID } from "node:crypto";
import {
  IntegrationError,
  fetchWithTimeout,
  mapHttpStatus,
  readJsonObject,
  type HttpTransport,
} from "./integration-error";
import {
  EU_COUNTRY_CODES,
  type EuCountryCode,
} from "./address-validation.server";

export type TrackingStatus =
  | "concept"
  | "registered"
  | "handed_over"
  | "in_transit"
  | "delivered"
  | "exception"
  | "returned"
  | "unknown";

export type MyParcelRecipient = {
  country: EuCountryCode;
  city: string;
  street: string;
  houseNumber: string;
  houseNumberAddition?: string | null;
  postcode: string;
  person: string;
  email: string;
  phone?: string | null;
  region?: string | null;
};

export type MyParcelShipmentDraft = {
  referenceIdentifier: string;
  recipient: MyParcelRecipient;
  carrierId?: number;
  packageType?: 1 | 2 | 6;
  weightGrams?: number | null;
  labelDescription?: string | null;
  tracked?: boolean;
};

export type MyParcelShipment = {
  id: string;
  referenceIdentifier: string;
  statusCode: number | null;
  trackingStatus: TrackingStatus;
  carrierId: number | null;
  barcode: string | null;
};

export type MyParcelTracking = {
  shipmentId: string;
  providerStatusCode: number | null;
  status: TrackingStatus;
  barcode: string | null;
  trackingUrl: string | null;
  delayed: boolean;
  final: boolean;
};

export type MyParcelLabel = {
  shipmentId: string;
  downloadUrl: string;
};

export type MyParcelClientOptions = {
  apiKey?: string;
  transport?: HttpTransport;
  timeoutMs?: number;
  baseUrl?: string;
  userAgent?: string;
};

type UnknownObject = Record<string, unknown>;

function objectValue(value: unknown): UnknownObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownObject)
    : null;
}

function stringValue(value: unknown, max = 255): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const result = String(value).trim();
  return result && result.length <= max ? result : null;
}

function integerValue(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function safeHttpsUrl(value: unknown, baseUrl?: string): string | null {
  const text = stringValue(value, 2_048);
  if (!text) return null;
  try {
    const url = new URL(text, baseUrl);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function requireText(value: string, field: string, max = 255): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  const hasControlCharacter = [...normalized].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
  if (!normalized || normalized.length > max || hasControlCharacter) {
    throw new TypeError(`Ongeldige MyParcel-invoer: ${field}.`);
  }
  return normalized;
}

export function mapMyParcelStatus(
  statusCode: number | null,
  mainStatus?: string | null,
): TrackingStatus {
  if ([10, 11].includes(statusCode ?? -1)) return "returned";
  switch (mainStatus) {
    case "registered":
      return "registered";
    case "handed_to_carrier":
      return "handed_over";
    case "sorting":
    case "distribution":
      return "in_transit";
    case "delivered":
      return "delivered";
  }
  if (statusCode === 1 || statusCode === 30) return "concept";
  if (statusCode === 2 || statusCode === 31) return "registered";
  if (statusCode === 3 || statusCode === 32) return "handed_over";
  if ([4, 5, 6, 8, 33, 34, 35, 37].includes(statusCode ?? -1)) {
    return "in_transit";
  }
  if ([7, 9, 19, 36, 38].includes(statusCode ?? -1)) {
    return "delivered";
  }
  if ([13, 16, 17].includes(statusCode ?? -1)) return "exception";
  if ([12, 14, 15, 18].includes(statusCode ?? -1)) return "registered";
  return "unknown";
}

function shipmentsFromResponse(body: UnknownObject): UnknownObject[] {
  const data = objectValue(body.data);
  if (!data) return [];
  const searchResults = objectValue(data.search_results);
  const candidates = searchResults?.shipments ?? data.shipments ?? data.results;
  return Array.isArray(candidates)
    ? candidates
        .map(objectValue)
        .filter((value): value is UnknownObject => Boolean(value))
    : [];
}

function shipmentFromObject(value: UnknownObject): MyParcelShipment | null {
  const id = stringValue(value.id, 32);
  const referenceIdentifier = stringValue(value.reference_identifier, 255);
  if (!id || !referenceIdentifier) return null;
  const statusCode = integerValue(value.status);
  return {
    id,
    referenceIdentifier,
    statusCode,
    trackingStatus: mapMyParcelStatus(statusCode),
    carrierId: integerValue(value.carrier_id ?? value.carrier),
    barcode: stringValue(value.barcode, 100),
  };
}

export function createMyParcelClient(options: MyParcelClientOptions) {
  const apiKey = options.apiKey?.trim();
  const transport = options.transport ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const baseUrl = (options.baseUrl ?? "https://api.myparcel.nl").replace(
    /\/$/,
    "",
  );
  const userAgent = options.userAgent ?? "VOLT-AfslankInjecties/1.0";

  function headers(extra: HeadersInit = {}): Headers {
    if (!apiKey) {
      throw new IntegrationError({
        provider: "myparcel",
        code: "not_configured",
        retryable: false,
      });
    }
    return new Headers({
      Authorization: `Basic ${Buffer.from(apiKey, "utf8").toString("base64")}`,
      "User-Agent": userAgent,
      ...Object.fromEntries(new Headers(extra).entries()),
    });
  }

  async function requestJson(
    url: URL | string,
    init: RequestInit,
  ): Promise<UnknownObject> {
    const response = await fetchWithTimeout(
      transport,
      url,
      init,
      timeoutMs,
      "myparcel",
    );
    if (!response.ok) throw mapHttpStatus("myparcel", response.status);
    return readJsonObject(response, "myparcel");
  }

  async function findByReference(
    referenceIdentifier: string,
  ): Promise<MyParcelShipment[]> {
    const reference = requireText(referenceIdentifier, "referenceIdentifier");
    const url = new URL("/shipments", baseUrl);
    url.searchParams.set("reference_identifier", reference);
    url.searchParams.set("page", "1");
    url.searchParams.set("size", "30");
    const body = await requestJson(url, {
      method: "GET",
      headers: headers({ Accept: "application/json;charset=utf-8" }),
    });
    return shipmentsFromResponse(body)
      .map(shipmentFromObject)
      .filter((shipment): shipment is MyParcelShipment => shipment !== null)
      .filter((shipment) => shipment.referenceIdentifier === reference);
  }

  async function createConceptShipment(
    draft: MyParcelShipmentDraft,
  ): Promise<MyParcelShipment> {
    const referenceIdentifier = requireText(
      draft.referenceIdentifier,
      "referenceIdentifier",
    );
    const carrier = draft.carrierId ?? 1;
    const packageType = draft.packageType ?? 1;
    if (!Number.isInteger(carrier) || carrier < 1 || carrier > 99) {
      throw new TypeError("Ongeldige MyParcel-invoer: carrierId.");
    }
    if (![1, 2, 6].includes(packageType)) {
      throw new TypeError("Ongeldige MyParcel-invoer: packageType.");
    }
    if (
      draft.weightGrams != null &&
      (!Number.isInteger(draft.weightGrams) ||
        draft.weightGrams < 1 ||
        draft.weightGrams > 30_000)
    ) {
      throw new TypeError("Ongeldige MyParcel-invoer: weightGrams.");
    }
    const recipient = draft.recipient;
    if (!EU_COUNTRY_CODES.includes(recipient.country)) {
      throw new TypeError("Ongeldige MyParcel-invoer: country.");
    }
    const email = requireText(recipient.email, "email", 254);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new TypeError("Ongeldige MyParcel-invoer: email.");
    }
    if (draft.tracked && ![2, 6].includes(packageType)) {
      throw new TypeError(
        "Ongeldige MyParcel-invoer: tracked vereist pakkettype 2 of 6.",
      );
    }
    const optionsPayload: UnknownObject = { package_type: packageType };
    if (draft.labelDescription) {
      optionsPayload.label_description = requireText(
        draft.labelDescription,
        "labelDescription",
      );
    }
    if (draft.tracked) optionsPayload.tracked = 1;
    const shipmentPayload: UnknownObject = {
      reference_identifier: referenceIdentifier,
      recipient: {
        cc: recipient.country,
        city: requireText(recipient.city, "city", 120),
        street: requireText(recipient.street, "street", 120),
        number: requireText(recipient.houseNumber, "houseNumber", 30),
        ...(recipient.houseNumberAddition
          ? {
              number_suffix: requireText(
                recipient.houseNumberAddition,
                "houseNumberAddition",
                30,
              ),
            }
          : {}),
        postal_code: requireText(recipient.postcode, "postcode", 16).replace(
          /\s/g,
          "",
        ),
        person: requireText(recipient.person, "person", 120),
        email,
        ...(recipient.phone
          ? { phone: requireText(recipient.phone, "phone", 40) }
          : {}),
        ...(recipient.region
          ? { region: requireText(recipient.region, "region", 120) }
          : {}),
      },
      options: optionsPayload,
      carrier,
      ...(draft.weightGrams
        ? { physical_properties: { weight: draft.weightGrams } }
        : {}),
    };
    const body = await requestJson(`${baseUrl}/shipments`, {
      method: "POST",
      headers: headers({
        Accept: "application/json;charset=utf-8",
        "Content-Type":
          "application/vnd.shipment+json;charset=utf-8;version=1.1",
      }),
      body: JSON.stringify({ data: { shipments: [shipmentPayload] } }),
    });
    const ids = objectValue(body.data)?.ids;
    const first = Array.isArray(ids) ? objectValue(ids[0]) : null;
    const id = stringValue(first?.id, 32);
    if (!id) {
      throw new IntegrationError({
        provider: "myparcel",
        code: "invalid_response",
        retryable: false,
      });
    }
    return {
      id,
      referenceIdentifier:
        stringValue(first?.reference_identifier, 255) ?? referenceIdentifier,
      statusCode: 1,
      trackingStatus: "concept",
      carrierId: carrier,
      barcode: null,
    };
  }

  async function getShipment(shipmentId: string): Promise<MyParcelShipment> {
    const id = requireText(shipmentId, "shipmentId", 32);
    if (!/^\d+$/.test(id))
      throw new TypeError("Ongeldige MyParcel-invoer: shipmentId.");
    const body = await requestJson(`${baseUrl}/shipments/${id}`, {
      method: "GET",
      headers: headers({ Accept: "application/json;charset=utf-8" }),
    });
    const shipments = shipmentsFromResponse(body);
    const shipment = shipments
      .map(shipmentFromObject)
      .find((value) => value?.id === id);
    if (!shipment) {
      throw new IntegrationError({
        provider: "myparcel",
        code: "invalid_response",
        retryable: false,
      });
    }
    return shipment;
  }

  async function requestLabelLink(
    shipmentId: string,
    format: "A4" | "A6" = "A6",
  ): Promise<MyParcelLabel> {
    const id = requireText(shipmentId, "shipmentId", 32);
    if (!/^\d+$/.test(id))
      throw new TypeError("Ongeldige MyParcel-invoer: shipmentId.");
    const url = new URL(`/shipment_labels/${id}`, baseUrl);
    url.searchParams.set("format", format);
    const body = await requestJson(url, {
      method: "GET",
      headers: headers({ Accept: "application/json;charset=utf-8" }),
    });
    const pdfs = objectValue(objectValue(body.data)?.pdfs);
    const downloadUrl = safeHttpsUrl(pdfs?.url, baseUrl);
    if (!downloadUrl) {
      throw new IntegrationError({
        provider: "myparcel",
        code: "invalid_response",
        retryable: false,
      });
    }
    return { shipmentId: id, downloadUrl };
  }

  async function getTracking(shipmentId: string): Promise<MyParcelTracking> {
    const id = requireText(shipmentId, "shipmentId", 32);
    if (!/^\d+$/.test(id))
      throw new TypeError("Ongeldige MyParcel-invoer: shipmentId.");
    const body = await requestJson(`${baseUrl}/tracktraces/${id}`, {
      method: "GET",
      headers: headers({
        Accept: "application/json;charset=utf-8",
        "Accept-Language": "nl_NL",
      }),
    });
    const tracktraces = objectValue(body.data)?.tracktraces;
    const rows = Array.isArray(tracktraces)
      ? tracktraces
          .map(objectValue)
          .filter((row): row is UnknownObject => Boolean(row))
      : [];
    const row = rows.find(
      (candidate) => stringValue(candidate.shipment_id, 32) === id,
    );
    if (!row) {
      throw new IntegrationError({
        provider: "myparcel",
        code: "not_found",
        retryable: false,
      });
    }
    const status = objectValue(row.status);
    const statusCode = integerValue(status?.current);
    const mainStatus = stringValue(status?.main, 64);
    const recipient = objectValue(row.recipient);
    return {
      shipmentId: id,
      providerStatusCode: statusCode,
      status: mapMyParcelStatus(statusCode, mainStatus),
      barcode:
        stringValue(row.barcode, 100) ?? stringValue(recipient?.barcode, 100),
      trackingUrl:
        safeHttpsUrl(row.link_consumer_portal) ??
        safeHttpsUrl(row.link_tracktrace),
      delayed: row.delayed === true,
      final: status?.final === true,
    };
  }

  return {
    findByReference,
    createConceptShipment,
    getShipment,
    requestLabelLink,
    getTracking,
  };
}

export function createMyParcelClientFromEnv(
  overrides: Omit<MyParcelClientOptions, "apiKey"> = {},
) {
  return createMyParcelClient({
    ...overrides,
    apiKey: process.env.MYPARCEL_API_KEY,
    baseUrl: overrides.baseUrl ?? process.env.MYPARCEL_API_BASE_URL,
  });
}

export type ShipmentCreationState =
  "pending" | "created" | "ambiguous" | "failed";

export type ShipmentCreationRecord = {
  orderId: string;
  referenceIdentifier: string;
  idempotencyKey: string;
  payloadHash: string;
  state: ShipmentCreationState;
  providerShipmentId: string | null;
};

export type ShipmentCreationClaim =
  | { kind: "claimed"; token: string; reconcileOnly: boolean }
  | { kind: "existing"; record: ShipmentCreationRecord }
  | { kind: "busy" }
  | { kind: "order_ineligible" }
  | { kind: "address_invalid" }
  | { kind: "conflict" };

export type ShipmentCreationRepository = {
  claim(input: {
    orderId: string;
    referenceIdentifier: string;
    idempotencyKey: string;
    payloadHash: string;
    addressFingerprint?: string;
    claimToken: string;
    claimExpiresAt: Date;
  }): Promise<ShipmentCreationClaim>;
  complete(input: {
    orderId: string;
    claimToken: string;
    shipment: MyParcelShipment;
  }): Promise<void>;
  markAmbiguous(input: { orderId: string; claimToken: string }): Promise<void>;
  markFailed(input: { orderId: string; claimToken: string }): Promise<void>;
};

export type EnsureShipmentResult =
  | { kind: "created_or_reconciled"; shipment: MyParcelShipment }
  | { kind: "existing"; record: ShipmentCreationRecord };

export class ShipmentCreationConflictError extends Error {
  constructor() {
    super("Deze verzendaanvraag hoort bij andere gegevens.");
    this.name = "ShipmentCreationConflictError";
  }
}

export class ShipmentCreationInProgressError extends Error {
  constructor() {
    super("De zending wordt al aangemaakt. Probeer het zo opnieuw.");
    this.name = "ShipmentCreationInProgressError";
  }
}

export class ShipmentCreationUncertainError extends Error {
  constructor() {
    super(
      "Een eerdere MyParcel-aanvraag is nog onzeker. Controleer MyParcel voordat je opnieuw probeert.",
    );
    this.name = "ShipmentCreationUncertainError";
  }
}

export class ShipmentAddressChangedError extends Error {
  constructor() {
    super(
      "Het bezorgadres is intussen gewijzigd of niet meer gevalideerd. Controleer het adres opnieuw.",
    );
    this.name = "ShipmentAddressChangedError";
  }
}

export class ShipmentOrderStatusChangedError extends Error {
  constructor() {
    super(
      "De bestelstatus is intussen gewijzigd. Voor deze bestelling kan geen MyParcel-concept worden aangemaakt.",
    );
    this.name = "ShipmentOrderStatusChangedError";
  }
}

function shipmentDraftHash(draft: MyParcelShipmentDraft): string {
  const canonical = JSON.stringify({
    referenceIdentifier: draft.referenceIdentifier.trim(),
    recipient: {
      country: draft.recipient.country,
      city: draft.recipient.city.trim(),
      street: draft.recipient.street.trim(),
      houseNumber: draft.recipient.houseNumber.trim(),
      houseNumberAddition: draft.recipient.houseNumberAddition?.trim() || null,
      postcode: draft.recipient.postcode.replace(/\s/g, "").toUpperCase(),
      person: draft.recipient.person.trim(),
      email: draft.recipient.email.trim().toLowerCase(),
      phone: draft.recipient.phone?.trim() || null,
      region: draft.recipient.region?.trim() || null,
    },
    carrierId: draft.carrierId ?? 1,
    packageType: draft.packageType ?? 1,
    weightGrams: draft.weightGrams ?? null,
    labelDescription: draft.labelDescription?.trim() || null,
    tracked: draft.tracked === true,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Coordinates a DB claim with MyParcel reconciliation. A retry after an
 * uncertain network result always searches the stable remote reference before
 * it is allowed to POST again.
 */
export function createIdempotentShipmentService(input: {
  client: ReturnType<typeof createMyParcelClient>;
  repository: ShipmentCreationRepository;
  now?: () => Date;
  claimTtlMs?: number;
}) {
  const now = input.now ?? (() => new Date());
  const claimTtlMs = input.claimTtlMs ?? 60_000;

  return {
    async ensureShipment(request: {
      orderId: string;
      idempotencyKey: string;
      addressFingerprint?: string;
      draft: MyParcelShipmentDraft;
    }): Promise<EnsureShipmentResult> {
      const payloadHash = shipmentDraftHash(request.draft);
      const claimToken = randomUUID();
      const claim = await input.repository.claim({
        orderId: request.orderId,
        referenceIdentifier: request.draft.referenceIdentifier,
        idempotencyKey: request.idempotencyKey,
        payloadHash,
        addressFingerprint: request.addressFingerprint,
        claimToken,
        claimExpiresAt: new Date(now().getTime() + claimTtlMs),
      });
      if (claim.kind === "conflict") throw new ShipmentCreationConflictError();
      if (claim.kind === "address_invalid") {
        throw new ShipmentAddressChangedError();
      }
      if (claim.kind === "order_ineligible") {
        throw new ShipmentOrderStatusChangedError();
      }
      if (claim.kind === "busy") throw new ShipmentCreationInProgressError();
      if (claim.kind === "existing" && claim.record.state === "created") {
        return { kind: "existing", record: claim.record };
      }
      if (claim.kind !== "claimed") throw new ShipmentCreationInProgressError();
      const activeClaimToken = claim.token;
      let conceptPostAttempted = false;
      let remoteShipmentObserved = false;

      try {
        const remote = await input.client.findByReference(
          request.draft.referenceIdentifier,
        );
        if (remote.length > 1) {
          await input.repository.markAmbiguous({
            orderId: request.orderId,
            claimToken: activeClaimToken,
          });
          throw new ShipmentCreationConflictError();
        }
        remoteShipmentObserved = remote.length === 1;
        let shipment = remote[0];
        if (!shipment) {
          if (claim.reconcileOnly) {
            await input.repository.markAmbiguous({
              orderId: request.orderId,
              claimToken: activeClaimToken,
            });
            throw new ShipmentCreationUncertainError();
          }
          conceptPostAttempted = true;
          shipment = await input.client.createConceptShipment(request.draft);
        }
        await input.repository.complete({
          orderId: request.orderId,
          claimToken: activeClaimToken,
          shipment,
        });
        return { kind: "created_or_reconciled", shipment };
      } catch (error) {
        if (
          error instanceof ShipmentCreationConflictError ||
          error instanceof ShipmentCreationUncertainError
        ) {
          throw error;
        }
        const definitelyRejected =
          conceptPostAttempted &&
          error instanceof IntegrationError &&
          error.retryable === false &&
          error.code === "remote_rejected";
        // A lookup failure before the first POST is safe to retry: no remote
        // shipment can have been created by this attempt. Once a POST may have
        // reached MyParcel, `reconcileOnly` is durable repository state and no
        // later reconciliation error may make the request POST-eligible again.
        const ambiguous =
          claim.reconcileOnly ||
          remoteShipmentObserved ||
          (conceptPostAttempted && !definitelyRejected);
        if (ambiguous) {
          await input.repository.markAmbiguous({
            orderId: request.orderId,
            claimToken: activeClaimToken,
          });
        } else {
          await input.repository.markFailed({
            orderId: request.orderId,
            claimToken: activeClaimToken,
          });
        }
        throw error;
      }
    },
  };
}
