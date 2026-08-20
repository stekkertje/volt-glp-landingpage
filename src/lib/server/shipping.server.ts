import { createHash, randomUUID } from "node:crypto";
import { getSql, withSqlTransaction, type Sql } from "@/lib/db";
import type { OrderStatus } from "@/lib/order-status";
import {
  addressValidationFingerprint,
  splitHouseNumber,
} from "./integrations/address-validation.server";
import { IntegrationError } from "./integrations/integration-error";
import {
  createIdempotentShipmentService,
  createMyParcelClientFromEnv,
  type MyParcelTracking,
} from "./integrations/myparcel.server";
import { createSqlShipmentCreationRepository } from "./integrations/shipment-repository.server";
import { getAdminOrderRecord, type AdminOrder } from "./orders.server";

type MyParcelClient = ReturnType<typeof createMyParcelClientFromEnv>;

type ShippingOrderRow = {
  id: string;
  order_number: string;
  email: string;
  name: string;
  phone: string | null;
  street: string;
  house_number: string;
  postcode: string;
  city: string;
  country: "NL" | "BE";
  status: OrderStatus;
  address_validation_status: string;
  address_validation_fingerprint: string | null;
};

type ShippingRow = {
  id: string;
  order_id: string;
  provider_shipment_id: string | null;
  creation_status: "pending" | "created" | "ambiguous" | "failed";
  barcode: string | null;
  tracking_url: string | null;
  provider_status_code: number | null;
  tracking_status: string;
  label_status: "not_requested" | "requested" | "ready" | "failed";
  label_requested_at: Date | string | null;
};

const LABEL_CLAIM_TTL_MS = 2 * 60 * 1_000;

export class ShipmentActionError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ShipmentActionError";
    this.status = status;
  }
}

function externalFailure(error: unknown): never {
  if (error instanceof ShipmentActionError) throw error;
  if (
    error instanceof Error &&
    (error.name === "ShipmentCreationConflictError" ||
      error.name === "ShipmentCreationInProgressError" ||
      error.name === "ShipmentCreationUncertainError" ||
      error.name === "ShipmentAddressChangedError")
  ) {
    throw new ShipmentActionError(error.message, 409);
  }
  if (error instanceof IntegrationError) {
    throw new ShipmentActionError(
      error.retryable
        ? "MyParcel is tijdelijk niet bereikbaar. Probeer het zo opnieuw."
        : error.code === "not_configured" || error.code === "unauthorized"
          ? "De MyParcel-koppeling is niet correct ingesteld."
          : "MyParcel heeft de verzendaanvraag niet geaccepteerd.",
      error.retryable ? 503 : 400,
    );
  }
  throw error;
}

async function loadShippingOrder(
  sql: Sql,
  orderId: string,
  forUpdate = false,
): Promise<ShippingOrderRow> {
  const rows = await sql.query<ShippingOrderRow>(
    `select id, order_number, email, name, phone, street, house_number, postcode,
       city, country, status, address_validation_status,
       address_validation_fingerprint
     from orders
     where id = $1
     limit 1${forUpdate ? " for update" : ""}`,
    [orderId],
  );
  const order = rows[0];
  if (!order) throw new ShipmentActionError("Bestelling niet gevonden.", 404);
  return order;
}

async function loadShippingRow(
  sql: Sql,
  orderId: string,
  forUpdate = false,
): Promise<ShippingRow> {
  const rows = await sql.query<ShippingRow>(
    `select id, order_id, provider_shipment_id, creation_status, barcode,
       tracking_url, provider_status_code, tracking_status, label_status,
       label_requested_at
     from order_shipments
     where order_id = $1
     order by created_at desc, id desc
     limit 1${forUpdate ? " for update" : ""}`,
    [orderId],
  );
  const shipment = rows[0];
  if (
    !shipment ||
    shipment.creation_status !== "created" ||
    !shipment.provider_shipment_id
  ) {
    throw new ShipmentActionError("Maak eerst het MyParcel-concept aan.");
  }
  return shipment;
}

function assertValidatedAddress(order: ShippingOrderRow): void {
  const fingerprint = addressValidationFingerprint({
    street: order.street,
    houseNumber: order.house_number,
    postcode: order.postcode,
    city: order.city,
    country: order.country,
  });
  if (
    order.address_validation_status !== "valid" ||
    order.address_validation_fingerprint !== fingerprint
  ) {
    throw new ShipmentActionError(
      "Controleer het gewijzigde bezorgadres voordat je een zending aanmaakt.",
    );
  }
}

function shipmentEventKey(input: {
  shipmentId: string;
  event: "created" | "tracking";
  value: unknown;
}): string {
  const digest = createHash("sha256")
    .update(JSON.stringify(input.value))
    .digest("hex")
    .slice(0, 24);
  return `shipment:${input.shipmentId}:${input.event}:${digest}`;
}

async function writeShipmentEvent(
  sql: Sql,
  input: {
    orderId: string;
    shipmentId: string;
    type: "shipment_created" | "shipment_tracking_changed";
    value: Record<string, unknown>;
  },
): Promise<void> {
  await sql`
    insert into order_events (
      id, order_id, event_type, dedupe_key, actor_type, payload, created_at
    ) values (
      ${randomUUID()}, ${input.orderId}, ${input.type},
      ${shipmentEventKey({
        shipmentId: input.shipmentId,
        event: input.type === "shipment_created" ? "created" : "tracking",
        value: input.value,
      })},
      'admin', ${JSON.stringify(input.value)}::jsonb, now()
    )
    on conflict (dedupe_key) do nothing
  `;
}

export type ShippingDependencies = {
  client?: MyParcelClient;
  now?: () => Date;
};

export async function createMyParcelConceptRecord(
  orderId: string,
  dependencies: ShippingDependencies = {},
): Promise<AdminOrder> {
  const sql = await getSql();
  const order = await loadShippingOrder(sql, orderId);
  if (!(["paid", "packed"] as OrderStatus[]).includes(order.status)) {
    throw new ShipmentActionError(
      "Een zending kan pas worden aangemaakt nadat de bestelling is betaald.",
    );
  }
  assertValidatedAddress(order);
  const houseNumber = splitHouseNumber(order.house_number);
  if (!houseNumber) {
    throw new ShipmentActionError(
      "Het huisnummer is niet geschikt voor MyParcel.",
    );
  }

  const client = dependencies.client ?? createMyParcelClientFromEnv();
  const service = createIdempotentShipmentService({
    client,
    repository: createSqlShipmentCreationRepository(),
  });
  try {
    const result = await service.ensureShipment({
      orderId: order.id,
      idempotencyKey: `myparcel:${order.id}:v1`,
      addressFingerprint: order.address_validation_fingerprint!,
      draft: {
        referenceIdentifier: order.order_number,
        recipient: {
          country: order.country,
          city: order.city,
          street: order.street,
          houseNumber: houseNumber.number,
          houseNumberAddition: houseNumber.addition,
          postcode: order.postcode,
          person: order.name,
          email: order.email,
          phone: order.phone,
        },
        carrierId: 1,
        packageType: 1,
        labelDescription: order.order_number,
      },
    });
    const shipmentRow = await loadShippingRow(sql, order.id);
    await writeShipmentEvent(sql, {
      orderId: order.id,
      shipmentId: shipmentRow.id,
      type: "shipment_created",
      value: {
        provider: "myparcel",
        providerShipmentId:
          result.kind === "created_or_reconciled"
            ? result.shipment.id
            : result.record.providerShipmentId,
      },
    });
    return getAdminOrderRecord(order.id);
  } catch (error) {
    externalFailure(error);
  }
}

export type LabelResult = {
  order: AdminOrder;
  downloadUrl: string;
};

export async function requestMyParcelLabelRecord(
  orderId: string,
  dependencies: ShippingDependencies = {},
): Promise<LabelResult> {
  const client = dependencies.client ?? createMyParcelClientFromEnv();
  const claimedAt = dependencies.now?.() ?? new Date();
  const shipment = await withSqlTransaction(async (sql) => {
    const order = await loadShippingOrder(sql, orderId, true);
    if (order.status === "cancelled" || order.status === "shipped") {
      throw new ShipmentActionError(
        "Voor een verzonden of geannuleerde bestelling kan geen label meer worden opgevraagd.",
        409,
      );
    }
    const lockedShipment = await loadShippingRow(sql, orderId, true);
    const activeClaim =
      lockedShipment.label_status === "requested" &&
      lockedShipment.label_requested_at !== null &&
      new Date(lockedShipment.label_requested_at).getTime() >
        claimedAt.getTime() - LABEL_CLAIM_TTL_MS;
    if (activeClaim) {
      throw new ShipmentActionError(
        "Het MyParcel-label wordt al opgevraagd. Probeer het zo opnieuw.",
        409,
      );
    }
    const claimed = await sql<{ id: string }>`
      update order_shipments
      set label_status = 'requested',
          label_requested_at = ${claimedAt.toISOString()},
          updated_at = now()
      where id = ${lockedShipment.id}
      returning id
    `;
    if (!claimed[0]) {
      throw new ShipmentActionError(
        "Het MyParcel-label kon niet worden geclaimd.",
        409,
      );
    }
    return lockedShipment;
  });

  let label: Awaited<ReturnType<MyParcelClient["requestLabelLink"]>>;
  try {
    label = await client.requestLabelLink(shipment.provider_shipment_id!, "A6");
  } catch (error) {
    const sql = await getSql();
    await sql`
      update order_shipments
      set label_status = 'failed', updated_at = now()
      where id = ${shipment.id}
        and label_status = 'requested'
        and label_requested_at = ${claimedAt.toISOString()}
    `;
    externalFailure(error);
  }
  const sql = await getSql();
  const ready = await sql<{ id: string }>`
    update order_shipments
    set label_status = 'ready', updated_at = now()
    where id = ${shipment.id}
      and label_status = 'requested'
      and label_requested_at = ${claimedAt.toISOString()}
    returning id
  `;
  if (!ready[0]) {
    throw new ShipmentActionError(
      "De labelaanvraag is intussen door een nieuwere actie vervangen.",
      409,
    );
  }
  return {
    order: await getAdminOrderRecord(orderId),
    downloadUrl: label!.downloadUrl,
  };
}

function trackingChanged(
  row: ShippingRow,
  tracking: MyParcelTracking,
): boolean {
  return (
    row.barcode !== tracking.barcode ||
    row.tracking_url !== tracking.trackingUrl ||
    row.provider_status_code !== tracking.providerStatusCode ||
    row.tracking_status !== tracking.status
  );
}

export async function refreshMyParcelTrackingRecord(
  orderId: string,
  dependencies: ShippingDependencies = {},
): Promise<AdminOrder> {
  const client = dependencies.client ?? createMyParcelClientFromEnv();
  try {
    await withSqlTransaction(async (sql) => {
      // All fulfillment-affecting admin actions lock the order first and then
      // its shipment. A fulfillment edit therefore cannot commit against stale
      // tracking while this provider refresh is in flight.
      await loadShippingOrder(sql, orderId, true);
      const shipment = await loadShippingRow(sql, orderId, true);
      const tracking: MyParcelTracking = await client.getTracking(
        shipment.provider_shipment_id!,
      );
      const changed = trackingChanged(shipment, tracking);
      await sql`
        update order_shipments
        set barcode = ${tracking.barcode}, tracking_url = ${tracking.trackingUrl},
            provider_status_code = ${tracking.providerStatusCode},
            tracking_status = ${tracking.status}, last_synced_at = now(),
            updated_at = now()
        where id = ${shipment.id}
      `;
      if (changed) {
        await writeShipmentEvent(sql, {
          orderId,
          shipmentId: shipment.id,
          type: "shipment_tracking_changed",
          value: {
            previousStatus: shipment.tracking_status,
            trackingStatus: tracking.status,
            barcode: tracking.barcode,
            trackingUrl: tracking.trackingUrl,
          },
        });
      }
    });
  } catch (error) {
    externalFailure(error);
  }
  return getAdminOrderRecord(orderId);
}
