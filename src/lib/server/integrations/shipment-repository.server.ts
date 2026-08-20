import { randomUUID } from "node:crypto";
import { withSqlTransaction, type Sql } from "@/lib/db";
import type {
  MyParcelShipment,
  ShipmentCreationClaim,
  ShipmentCreationRecord,
  ShipmentCreationRepository,
  ShipmentCreationState,
} from "./myparcel.server";

type ShipmentCreationRow = {
  order_id: string;
  reference_identifier: string;
  create_idempotency_key: string;
  payload_hash: string;
  creation_status: ShipmentCreationState;
  creation_claim_token: string | null;
  creation_claim_expires_at: Date | string | null;
  provider_shipment_id: string | null;
};

function toRecord(row: ShipmentCreationRow): ShipmentCreationRecord {
  return {
    orderId: row.order_id,
    referenceIdentifier: row.reference_identifier,
    idempotencyKey: row.create_idempotency_key,
    payloadHash: row.payload_hash,
    state: row.creation_status,
    providerShipmentId: row.provider_shipment_id,
  };
}

async function lockByCreationIdentity(
  sql: Sql,
  input: {
    orderId: string;
    referenceIdentifier: string;
    idempotencyKey: string;
  },
): Promise<ShipmentCreationRow | null> {
  const rows = await sql<ShipmentCreationRow>`
    select order_id, reference_identifier, create_idempotency_key, payload_hash,
      creation_status, creation_claim_token, creation_claim_expires_at,
      provider_shipment_id
    from order_shipments
    where reference_identifier = ${input.referenceIdentifier}
      or create_idempotency_key = ${input.idempotencyKey}
    order by created_at desc
    limit 1
    for update
  `;
  return rows[0] ?? null;
}

function claimMatches(
  row: ShipmentCreationRow,
  input: {
    orderId: string;
    referenceIdentifier: string;
    idempotencyKey: string;
    payloadHash: string;
  },
): boolean {
  return (
    row.order_id === input.orderId &&
    row.reference_identifier === input.referenceIdentifier &&
    row.create_idempotency_key === input.idempotencyKey &&
    row.payload_hash === input.payloadHash
  );
}

function creationIdentityMatches(
  row: ShipmentCreationRow,
  input: {
    orderId: string;
    referenceIdentifier: string;
    idempotencyKey: string;
  },
): boolean {
  return (
    row.order_id === input.orderId &&
    row.reference_identifier === input.referenceIdentifier &&
    row.create_idempotency_key === input.idempotencyKey
  );
}

function claimIsActive(row: ShipmentCreationRow, now: Date): boolean {
  if (!row.creation_claim_token || !row.creation_claim_expires_at) return false;
  return new Date(row.creation_claim_expires_at).getTime() > now.getTime();
}

/**
 * PostgreSQL/PGLite implementation of the creation claim contract. The claim
 * is short-lived and never kept open while an external API request runs.
 */
export function createSqlShipmentCreationRepository(
  options: {
    now?: () => Date;
  } = {},
): ShipmentCreationRepository {
  const now = options.now ?? (() => new Date());

  return {
    claim(input): Promise<ShipmentCreationClaim> {
      return withSqlTransaction(async (sql) => {
        // This is the authoritative eligibility check. The caller builds its
        // draft from an earlier read, so status and address must be rechecked
        // while holding the same order lock that precedes the shipment claim.
        const orders = await sql<{
          status: string;
          address_validation_status: string;
          address_validation_fingerprint: string | null;
        }>`
          select status, address_validation_status,
            address_validation_fingerprint
          from orders
          where id = ${input.orderId}
          limit 1
          for update
        `;
        const order = orders[0];
        if (!order || !["paid", "packed"].includes(order.status)) {
          return { kind: "order_ineligible" };
        }
        if (
          input.addressFingerprint &&
          (order.address_validation_status !== "valid" ||
            order.address_validation_fingerprint !== input.addressFingerprint)
        ) {
          return { kind: "address_invalid" };
        }
        let row = await lockByCreationIdentity(sql, input);
        if (!row) {
          const inserted = await sql<ShipmentCreationRow>`
            insert into order_shipments (
              id, order_id, provider, reference_identifier,
              create_idempotency_key, payload_hash, creation_status,
              creation_claim_token, creation_claim_expires_at,
              tracking_status, label_status, created_at, updated_at
            ) values (
              ${randomUUID()}, ${input.orderId}, 'myparcel',
              ${input.referenceIdentifier}, ${input.idempotencyKey},
              ${input.payloadHash}, 'pending', ${input.claimToken},
              ${input.claimExpiresAt}, 'concept', 'not_requested', now(), now()
            )
            on conflict do nothing
            returning order_id, reference_identifier, create_idempotency_key,
              payload_hash, creation_status, creation_claim_token,
              creation_claim_expires_at, provider_shipment_id
          `;
          row = inserted[0] ?? (await lockByCreationIdentity(sql, input));
        }
        if (!row || !creationIdentityMatches(row, input)) {
          return { kind: "conflict" };
        }
        const reconcileOnly =
          row.creation_status === "ambiguous" ||
          (row.creation_status === "pending" &&
            row.creation_claim_token !== input.claimToken);
        if (row.payload_hash !== input.payloadHash) {
          // A provider-rejected (not ambiguous) request is the only state that
          // may be rebound to a newly validated address. The order row is still
          // locked above, so an address mutation cannot race this reset.
          if (
            row.creation_status !== "failed" ||
            row.provider_shipment_id !== null ||
            row.creation_claim_token !== null
          ) {
            return { kind: "conflict" };
          }
          const reset = await sql<{ order_id: string }>`
            update order_shipments
            set payload_hash = ${input.payloadHash},
                creation_status = 'pending',
                creation_claim_token = ${input.claimToken},
                creation_claim_expires_at = ${input.claimExpiresAt},
                carrier_id = null,
                barcode = null,
                tracking_url = null,
                provider_status_code = null,
                tracking_status = 'concept',
                label_status = 'not_requested',
                label_requested_at = null,
                last_synced_at = null,
                updated_at = now()
            where order_id = ${input.orderId}
              and reference_identifier = ${input.referenceIdentifier}
              and create_idempotency_key = ${input.idempotencyKey}
              and creation_status = 'failed'
              and provider_shipment_id is null
              and creation_claim_token is null
            returning order_id
          `;
          return reset.length === 1
            ? {
                kind: "claimed",
                token: input.claimToken,
                reconcileOnly: false,
              }
            : { kind: "busy" };
        }
        if (!claimMatches(row, input)) return { kind: "conflict" };
        if (row.creation_status === "created") {
          return { kind: "existing", record: toRecord(row) };
        }
        if (
          claimIsActive(row, now()) &&
          row.creation_claim_token !== input.claimToken
        ) {
          return { kind: "busy" };
        }
        const claimed = await sql<{ order_id: string }>`
          update order_shipments
          set creation_status = ${reconcileOnly ? "ambiguous" : "pending"},
              creation_claim_token = ${input.claimToken},
              creation_claim_expires_at = ${input.claimExpiresAt},
              updated_at = now()
          where order_id = ${input.orderId}
            and create_idempotency_key = ${input.idempotencyKey}
            and payload_hash = ${input.payloadHash}
            and creation_status <> 'created'
            and (
              creation_claim_token is null
              or creation_claim_expires_at <= ${now()}
              or creation_claim_token = ${input.claimToken}
            )
          returning order_id
        `;
        return claimed.length > 0
          ? { kind: "claimed", token: input.claimToken, reconcileOnly }
          : { kind: "busy" };
      });
    },

    async complete(input: {
      orderId: string;
      claimToken: string;
      shipment: MyParcelShipment;
    }): Promise<void> {
      const updated = await withSqlTransaction(
        (sql) => sql<{ id: string }>`
        update order_shipments
        set creation_status = 'created',
            creation_claim_token = null,
            creation_claim_expires_at = null,
            provider_shipment_id = ${input.shipment.id},
            carrier_id = ${input.shipment.carrierId},
            barcode = ${input.shipment.barcode},
            provider_status_code = ${input.shipment.statusCode},
            tracking_status = ${input.shipment.trackingStatus},
            updated_at = now()
        where order_id = ${input.orderId}
          and creation_status in ('pending', 'ambiguous')
          and creation_claim_token = ${input.claimToken}
        returning id
      `,
      );
      if (updated.length !== 1) {
        throw new Error("De verzendclaim is intussen gewijzigd.");
      }
    },

    async markAmbiguous(input): Promise<void> {
      await withSqlTransaction(
        (sql) => sql`
        update order_shipments
        set creation_status = 'ambiguous',
            creation_claim_token = null,
            creation_claim_expires_at = null,
            updated_at = now()
        where order_id = ${input.orderId}
          and creation_status in ('pending', 'ambiguous')
          and creation_claim_token = ${input.claimToken}
      `,
      ).then(() => undefined);
    },

    async markFailed(input): Promise<void> {
      await withSqlTransaction(
        (sql) => sql`
        update order_shipments
        set creation_status = 'failed',
            creation_claim_token = null,
            creation_claim_expires_at = null,
            updated_at = now()
        where order_id = ${input.orderId}
          and creation_status = 'pending'
          and creation_claim_token = ${input.claimToken}
      `,
      ).then(() => undefined);
    },
  };
}
