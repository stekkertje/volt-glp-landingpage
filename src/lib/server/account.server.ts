import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { getSql, withSqlTransaction, type Sql } from "@/lib/db";
import type { OrderStatus } from "@/lib/order-status";
import { guestOrderClaimMail } from "@/lib/server/account-mail-templates.server";
import { queueTransactionalMail } from "@/lib/server/mail/outbox.server";

const CLAIM_TOKEN_TTL_MS = 30 * 60 * 1_000;
const CLAIM_TOKEN_CONTEXT = "volt-guest-order-claim";

const PUBLIC_TRACKING_STATUSES = [
  "concept",
  "registered",
  "handed_over",
  "in_transit",
  "delivered",
  "exception",
  "returned",
  "unknown",
] as const;

export type PublicTrackingStatus = (typeof PUBLIC_TRACKING_STATUSES)[number];

export type AccountOrderLine = {
  id: string;
  slug: string;
  optionId: string;
  name: string;
  optionLabel: string;
  unitPriceCents: number;
  qty: number;
  lineTotalCents: number;
};

export type AccountOrder = {
  id: string;
  orderNumber: string;
  email: string;
  name: string;
  phone: string | null;
  street: string;
  houseNumber: string;
  postcode: string;
  city: string;
  country: "NL" | "BE";
  status: OrderStatus;
  subtotalCents: number;
  stackDiscountCents: number;
  codeDiscountCents: number;
  shippingCents: number;
  totalCents: number;
  discountCode: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  lines: AccountOrderLine[];
  tracking: {
    barcode: string | null;
    trackingUrl: string | null;
    trackingStatus: PublicTrackingStatus;
    lastSyncedAt: string | null;
  } | null;
};

type AccountOrderRow = {
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
  subtotal_cents: number;
  stack_discount_cents: number;
  code_discount_cents: number;
  shipping_cents: number;
  total_cents: number;
  discount_code: string | null;
  note: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  barcode: string | null;
  tracking_url: string | null;
  tracking_status: string | null;
  last_synced_at: Date | string | null;
};

type AccountOrderLineRow = {
  id: string;
  order_id: string;
  slug: string;
  option_id: string;
  name: string;
  option_label: string;
  unit_price_cents: number;
  qty: number;
  line_total_cents: number;
};

type VerifiedAccountRow = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
};

export class GuestOrderClaimError extends Error {
  readonly status = 400;

  constructor() {
    super("Deze bevestigingslink is ongeldig, verlopen of al gebruikt.");
    this.name = "GuestOrderClaimError";
  }
}

export class AccountEmailVerificationRequiredError extends Error {
  readonly status = 403;

  constructor() {
    super("Bevestig eerst je e-mailadres.");
    this.name = "AccountEmailVerificationRequiredError";
  }
}

function asIsoString(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function normalizedEmail(value: string): string {
  return value.trim().toLowerCase();
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function tokenHash(token: string): string {
  return sha256(`${CLAIM_TOKEN_CONTEXT}\0${token}`);
}

function emailHash(email: string): string {
  return sha256(normalizedEmail(email));
}

function safeHashEqual(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function publicTrackingStatus(value: string | null): PublicTrackingStatus {
  return PUBLIC_TRACKING_STATUSES.includes(value as PublicTrackingStatus)
    ? (value as PublicTrackingStatus)
    : "unknown";
}

async function verifiedAccount(
  sql: Sql,
  userId: string,
): Promise<VerifiedAccountRow> {
  const rows = await sql<VerifiedAccountRow>`
    select "id", "name", "email", "emailVerified"
    from "user"
    where "id" = ${userId}
    limit 1
    for update
  `;
  const account = rows[0];
  if (!account) throw new GuestOrderClaimError();
  if (!account.emailVerified) {
    throw new AccountEmailVerificationRequiredError();
  }
  return account;
}

export async function listAccountOrderRecords(
  userId: string,
): Promise<AccountOrder[]> {
  const sql = await getSql();
  const orders = await sql<AccountOrderRow>`
    select
      o.id, o.order_number, o.email, o.name, o.phone, o.street,
      o.house_number, o.postcode, o.city, o.country, o.status,
      o.subtotal_cents, o.stack_discount_cents, o.code_discount_cents,
      o.shipping_cents, o.total_cents, o.discount_code, o.note,
      o.created_at, o.updated_at,
      shipment.barcode, shipment.tracking_url, shipment.tracking_status,
      shipment.last_synced_at
    from orders o
    left join lateral (
      select barcode, tracking_url, tracking_status, last_synced_at
      from order_shipments
      where order_id = o.id
        and creation_status = 'created'
      order by created_at desc, id desc
      limit 1
    ) shipment on true
    where o.user_id = ${userId}
    order by o.created_at desc
    limit 100
  `;
  if (!orders.length) return [];

  const orderIds = orders.map((order) => order.id);
  const placeholders = orderIds.map((_, index) => `$${index + 1}`).join(", ");
  const lines = await sql.query<AccountOrderLineRow>(
    `select id, order_id, slug, option_id, name, option_label,
       unit_price_cents, qty, line_total_cents
     from order_lines
     where order_id in (${placeholders})
     order by order_id, id`,
    orderIds,
  );
  const linesByOrder = new Map<string, AccountOrderLine[]>();
  for (const line of lines) {
    const group = linesByOrder.get(line.order_id) ?? [];
    group.push({
      id: line.id,
      slug: line.slug,
      optionId: line.option_id,
      name: line.name,
      optionLabel: line.option_label,
      unitPriceCents: line.unit_price_cents,
      qty: line.qty,
      lineTotalCents: line.line_total_cents,
    });
    linesByOrder.set(line.order_id, group);
  }

  return orders.map((order) => ({
    id: order.id,
    orderNumber: order.order_number,
    email: order.email,
    name: order.name,
    phone: order.phone,
    street: order.street,
    houseNumber: order.house_number,
    postcode: order.postcode,
    city: order.city,
    country: order.country,
    status: order.status,
    subtotalCents: order.subtotal_cents,
    stackDiscountCents: order.stack_discount_cents,
    codeDiscountCents: order.code_discount_cents,
    shippingCents: order.shipping_cents,
    totalCents: order.total_cents,
    discountCode: order.discount_code,
    note: order.note,
    createdAt: asIsoString(order.created_at),
    updatedAt: asIsoString(order.updated_at),
    lines: linesByOrder.get(order.id) ?? [],
    tracking:
      order.barcode || order.tracking_url || order.tracking_status
        ? {
            barcode: order.barcode,
            trackingUrl: order.tracking_url,
            trackingStatus: publicTrackingStatus(order.tracking_status),
            lastSyncedAt: order.last_synced_at
              ? asIsoString(order.last_synced_at)
              : null,
          }
        : null,
  }));
}

export async function requestGuestOrderClaimRecord(input: {
  userId: string;
  publicOrigin: string;
}): Promise<void> {
  await withSqlTransaction(async (sql) => {
    const account = await verifiedAccount(sql, input.userId);
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + CLAIM_TOKEN_TTL_MS);
    const token = randomBytes(32).toString("base64url");
    const hashedToken = tokenHash(token);

    await sql`
      update order_claim_tokens
      set consumed_at = ${issuedAt.toISOString()}
      where user_id = ${account.id}
        and consumed_at is null
        and expires_at > ${issuedAt.toISOString()}
    `;
    await sql`
      insert into order_claim_tokens (
        id, user_id, normalized_email_hash, token_hash,
        issued_at, expires_at, consumed_at
      ) values (
        ${randomUUID()}, ${account.id}, ${emailHash(account.email)},
        ${hashedToken}, ${issuedAt.toISOString()}, ${expiresAt.toISOString()}, null
      )
    `;

    const claimUrl = `${input.publicOrigin}/account#claim=${encodeURIComponent(token)}`;
    await queueTransactionalMail(
      sql,
      guestOrderClaimMail({
        dedupeKey: `guest-order-claim:${hashedToken}`,
        userId: account.id,
        email: account.email,
        name: account.name,
        url: claimUrl,
      }),
    );
  });
}

export async function confirmGuestOrderClaimRecord(input: {
  userId: string;
  token: string;
}): Promise<{ linkedOrders: number }> {
  return withSqlTransaction(async (sql) => {
    const account = await verifiedAccount(sql, input.userId);
    const now = new Date().toISOString();
    const hash = tokenHash(input.token);
    const rows = await sql<{
      id: string;
      normalized_email_hash: string;
    }>`
      select id, normalized_email_hash
      from order_claim_tokens
      where token_hash = ${hash}
        and user_id = ${account.id}
        and consumed_at is null
        and expires_at > ${now}
      limit 1
      for update
    `;
    const claim = rows[0];
    if (
      !claim ||
      !safeHashEqual(claim.normalized_email_hash, emailHash(account.email))
    ) {
      throw new GuestOrderClaimError();
    }

    const consumed = await sql<{ id: string }>`
      update order_claim_tokens
      set consumed_at = ${now}
      where id = ${claim.id}
        and consumed_at is null
        and expires_at > ${now}
      returning id
    `;
    if (!consumed[0]) throw new GuestOrderClaimError();

    const linked = await sql<{ id: string }>`
      update orders
      set user_id = ${account.id}, updated_at = now()
      where user_id is null
        and lower(trim(email)) = ${normalizedEmail(account.email)}
      returning id
    `;
    return { linkedOrders: linked.length };
  });
}
