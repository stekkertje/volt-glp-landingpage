import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { getSql, withSqlTransaction, type Sql } from "@/lib/db";
import { labelClaimIsActive } from "@/lib/server/shipment-claim-policy";
import { canonicalCheckoutPayload } from "@/lib/checkout-idempotency";
import { getOption, getProduct } from "@/lib/product";
import {
  ORDER_STATUSES,
  isOrderStatusTransitionAllowed,
  type OrderStatus,
} from "@/lib/order-status";
import {
  calculatePricing,
  type DiscountCodeRecord,
} from "@/lib/server/pricing";
import {
  createOrderSchema,
  updateOrderAddressSchema,
  updateOrderFulfillmentSchema,
  type CreateOrderInput,
  type OrderViewerInput,
  type UpdateOrderAddressInput,
  type UpdateOrderFulfillmentInput,
} from "@/lib/server/order-schema";
import { verifyAddressValidationToken } from "@/lib/server/address-validation-token.server";
import type { TrackingStatus } from "@/lib/server/integrations/myparcel.server";
import { resolveMailOwnerAddress } from "@/lib/server/mail/config.server";
import { queueTransactionalMail } from "@/lib/server/mail/outbox.server";
import {
  orderAddressChangedMail,
  orderCustomerConfirmationMail,
  orderOwnerConfirmationMail,
  orderProductsChangedMail,
  orderStatusChangedMail,
} from "@/lib/server/mail/templates";

export type { OrderStatus } from "@/lib/order-status";

export type PublicOrderLine = {
  id: string;
  slug: string;
  optionId: string;
  name: string;
  optionLabel: string;
  unitPriceCents: number;
  qty: number;
  lineTotalCents: number;
};

export type PublicFulfillmentLine = {
  id: string;
  slug: string;
  optionId: string;
  name: string;
  optionLabel: string;
  qty: number;
};

export type PublicOrder = {
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
  lines: PublicOrderLine[];
  tracking: PublicShipmentTracking | null;
};

export type AdminOrder = PublicOrder & {
  fulfillmentLines: PublicFulfillmentLine[];
  addressValidationStatus:
    "unvalidated" | "valid" | "needs_confirmation" | "invalid" | "unavailable";
  shipment: AdminShipment | null;
};

export type PublicShipmentTracking = {
  barcode: string | null;
  trackingUrl: string | null;
  trackingStatus: TrackingStatus;
  lastSyncedAt: string | null;
};

export type AdminShipment = PublicShipmentTracking & {
  id: string;
  creationStatus: "pending" | "created" | "ambiguous" | "failed";
  providerShipmentId: string | null;
  carrierId: number | null;
  providerStatusCode: number | null;
  labelStatus: "not_requested" | "requested" | "ready" | "failed";
  labelRequestedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OrderSummary = {
  id: string;
  orderNumber: string;
  name: string;
  email: string;
  status: OrderStatus;
  totalCents: number;
  createdAt: string;
};

type OrderRow = {
  id: string;
  order_number: string;
  user_id: string | null;
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
  address_validation_provider: "apicheck" | "google" | null;
  address_validation_status:
    "unvalidated" | "valid" | "needs_confirmation" | "invalid" | "unavailable";
  address_validation_fingerprint: string | null;
  address_validated_at: Date | string | null;
  idempotency_payload_hash: string | null;
  idempotency_viewer_hash: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type ShipmentRow = {
  id: string;
  creation_status: AdminShipment["creationStatus"];
  provider_shipment_id: string | null;
  carrier_id: number | null;
  barcode: string | null;
  tracking_url: string | null;
  provider_status_code: number | null;
  tracking_status: TrackingStatus;
  label_status: AdminShipment["labelStatus"];
  label_requested_at: Date | string | null;
  last_synced_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type OrderLineRow = {
  id: string;
  slug: string;
  option_id: string;
  name: string;
  option_label: string;
  unit_price_cents: number;
  qty: number;
  line_total_cents: number;
};

type FulfillmentLineRow = {
  id: string;
  slug: string;
  option_id: string;
  name: string;
  option_label: string;
  qty: number;
};

export type CreateOrderRecordResult = {
  order: PublicOrder;
  guestAccessToken: string;
  replayed: boolean;
};

export type OrderViewer = OrderViewerInput & {
  cookieOrderId?: string | null;
  cookieAccessToken?: string | null;
  userId?: string | null;
  isAdmin?: boolean;
};

const TOKEN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ORDER_ACCESS_ERROR = "Bestelling niet gevonden of niet toegankelijk.";
export const GUEST_ACCESS_TOKEN_TTL_MS = 72 * 60 * 60 * 1_000;
const TOKEN_CIPHER_VERSION = "v1";
const TOKEN_CIPHER_CONTEXT = "volt-order-access-token";
const ORDER_ACCESS_TOKEN_SECRET_MIN_LENGTH = 32;

const globalOrderSecurity = globalThis as typeof globalThis & {
  __voltOrderAccessTokenSecret__?: Buffer;
};

export class OrderAccessError extends Error {
  constructor() {
    super(ORDER_ACCESS_ERROR);
    this.name = "OrderAccessError";
  }
}

export class IdempotencyConflictError extends Error {
  readonly status = 409;

  constructor() {
    super("Deze herhaalcode hoort bij een andere bestelling.");
    this.name = "IdempotencyConflictError";
  }
}

export class IdempotencyReplayExpiredError extends Error {
  readonly status = 410;

  constructor() {
    super("De tijdelijke toegang tot deze bestelling is verlopen.");
    this.name = "IdempotencyReplayExpiredError";
  }
}

export class IdempotencyReplayUnavailableError extends Error {
  readonly status = 503;

  constructor() {
    super(
      "De bestaande bestelling kan niet veilig opnieuw worden geopend. Neem contact op met de beheerder.",
    );
    this.name = "IdempotencyReplayUnavailableError";
  }
}

export class OrderStatusTransitionError extends Error {
  readonly status = 409;

  constructor() {
    super("Deze statusovergang is niet toegestaan.");
    this.name = "OrderStatusTransitionError";
  }
}

export class OrderStatusConflictError extends Error {
  readonly status = 409;

  constructor() {
    super("De bestelstatus is intussen gewijzigd. Vernieuw het overzicht.");
    this.name = "OrderStatusConflictError";
  }
}

export class OrderUpdateConflictError extends Error {
  readonly status = 409;

  constructor() {
    super("De bestelling is intussen gewijzigd. Vernieuw het overzicht.");
    this.name = "OrderUpdateConflictError";
  }
}

export class OrderFulfillmentError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "OrderFulfillmentError";
  }
}

export class OrderFulfillmentLockedError extends Error {
  readonly status = 409;

  constructor() {
    super(
      "De te leveren producten zijn vergrendeld omdat de bestelling is afgerond of de verzending al in uitvoering is.",
    );
    this.name = "OrderFulfillmentLockedError";
  }
}

export class OrderAddressLockedError extends Error {
  readonly status = 409;

  constructor() {
    super(
      "Het bezorgadres kan niet meer worden gewijzigd nadat een MyParcel-concept is aangemaakt.",
    );
    this.name = "OrderAddressLockedError";
  }
}

function randomCharacters(length: number): string {
  const bytes = randomBytes(length);
  let value = "";
  for (const byte of bytes) value += TOKEN_ALPHABET[byte & 31];
  return value;
}

export function generateGuestAccessToken(): string {
  return randomCharacters(32).replace(/(.{4})(?=.)/g, "$1-");
}

export function normalizeGuestAccessToken(token: string): string {
  return token
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashGuestAccessToken(token: string): string {
  return sha256(normalizeGuestAccessToken(token));
}

function deriveAccessTokenEncryptionKey(secret: string): Buffer {
  return createHash("sha256")
    .update(TOKEN_CIPHER_CONTEXT)
    .update("\0")
    .update(secret)
    .digest();
}

function configuredPreviousAccessTokenSecrets(): string[] {
  return (process.env.ORDER_ACCESS_TOKEN_PREVIOUS_SECRETS ?? "")
    .split(",")
    .map((secret) => secret.trim())
    .filter(Boolean);
}

function stableAccessTokenSecretRequired(): boolean {
  const localBuild =
    ["build", "db:migrate"].includes(process.env.npm_lifecycle_event ?? "") &&
    process.env.VERCEL !== "1" &&
    process.env.NETLIFY !== "true" &&
    process.env.REQUIRE_DATABASE !== "1" &&
    process.env.REQUIRE_DATABASE?.toLowerCase() !== "true";
  return Boolean(
    process.env.DATABASE_URL?.trim() ||
    process.env.VERCEL === "1" ||
    process.env.NETLIFY === "true" ||
    process.env.REQUIRE_DATABASE === "1" ||
    process.env.REQUIRE_DATABASE?.toLowerCase() === "true" ||
    (process.env.NODE_ENV === "production" && !localBuild),
  );
}

function configuredCurrentAccessTokenSecret(): string | null {
  const secret = process.env.ORDER_ACCESS_TOKEN_SECRET?.trim() || null;
  if (secret && secret.length < ORDER_ACCESS_TOKEN_SECRET_MIN_LENGTH) {
    throw new Error(
      `ORDER_ACCESS_TOKEN_SECRET moet minimaal ${ORDER_ACCESS_TOKEN_SECRET_MIN_LENGTH} tekens bevatten.`,
    );
  }
  for (const previousSecret of configuredPreviousAccessTokenSecrets()) {
    if (previousSecret.length < ORDER_ACCESS_TOKEN_SECRET_MIN_LENGTH) {
      throw new Error(
        `Iedere waarde in ORDER_ACCESS_TOKEN_PREVIOUS_SECRETS moet minimaal ${ORDER_ACCESS_TOKEN_SECRET_MIN_LENGTH} tekens bevatten.`,
      );
    }
  }
  if (!secret && stableAccessTokenSecretRequired()) {
    const authSecret = process.env.BETTER_AUTH_SECRET?.trim() || null;
    if (!authSecret) {
      throw new Error(
        "ORDER_ACCESS_TOKEN_SECRET of BETTER_AUTH_SECRET is verplicht bij een persistente of production database.",
      );
    }
    if (authSecret.length < ORDER_ACCESS_TOKEN_SECRET_MIN_LENGTH) {
      throw new Error(
        `BETTER_AUTH_SECRET moet minimaal ${ORDER_ACCESS_TOKEN_SECRET_MIN_LENGTH} tekens bevatten wanneer het als fallback voor besteltoegang wordt gebruikt.`,
      );
    }
    return authSecret;
  }
  return secret;
}

function developmentAccessTokenEncryptionKey(): Buffer {
  globalOrderSecurity.__voltOrderAccessTokenSecret__ ??= randomBytes(32);
  return globalOrderSecurity.__voltOrderAccessTokenSecret__;
}

function currentAccessTokenEncryptionKey(): Buffer {
  const configuredSecret = configuredCurrentAccessTokenSecret();
  return configuredSecret
    ? deriveAccessTokenEncryptionKey(configuredSecret)
    : developmentAccessTokenEncryptionKey();
}

// Fail a persistent/production deployment during module bootstrap rather than
// discovering a missing or weak key on the first checkout request.
configuredCurrentAccessTokenSecret();

function accessTokenDecryptionKeys(): Buffer[] {
  const keys: Buffer[] = [currentAccessTokenEncryptionKey()];
  const legacySecrets = [
    ...configuredPreviousAccessTokenSecrets(),
    process.env.BETTER_AUTH_SECRET?.trim(),
    process.env.DATABASE_URL?.trim(),
  ].filter((secret): secret is string => Boolean(secret));
  for (const secret of legacySecrets) {
    const candidate = deriveAccessTokenEncryptionKey(secret);
    if (!keys.some((key) => key.equals(candidate))) keys.push(candidate);
  }
  const developmentKey = globalOrderSecurity.__voltOrderAccessTokenSecret__;
  if (developmentKey && !keys.some((key) => key.equals(developmentKey))) {
    keys.push(developmentKey);
  }
  return keys;
}

function encryptGuestAccessToken(orderId: string, token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    currentAccessTokenEncryptionKey(),
    iv,
  );
  cipher.setAAD(Buffer.from(`${TOKEN_CIPHER_CONTEXT}\0${orderId}`, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  return [
    TOKEN_CIPHER_VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

function decryptGuestAccessToken(
  orderId: string,
  encryptedToken: string,
): { token: string; keyIndex: number } | null {
  const [version, ivValue, tagValue, ciphertextValue, ...extra] =
    encryptedToken.split(".");
  if (
    version !== TOKEN_CIPHER_VERSION ||
    !ivValue ||
    !tagValue ||
    !ciphertextValue ||
    extra.length
  ) {
    return null;
  }
  const keys = accessTokenDecryptionKeys();
  for (const [keyIndex, key] of keys.entries()) {
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(ivValue, "base64url"),
      );
      decipher.setAAD(
        Buffer.from(`${TOKEN_CIPHER_CONTEXT}\0${orderId}`, "utf8"),
      );
      decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
      const token = Buffer.concat([
        decipher.update(Buffer.from(ciphertextValue, "base64url")),
        decipher.final(),
      ]).toString("utf8");
      return { token, keyIndex };
    } catch {
      // Try the next configured rotation or legacy key.
    }
  }
  return null;
}

function canonicalPayloadHash(input: CreateOrderInput): string {
  return sha256(canonicalCheckoutPayload(input));
}

function viewerBindingHash(
  input: CreateOrderInput,
  userId: string | null,
): string {
  return sha256(userId ? `user:${userId}` : `guest:${input.email}`);
}

function hashMatches(actual: string, expected: string | null): boolean {
  if (!expected || !/^[a-f0-9]{64}$/i.test(expected)) return false;
  const actualBuffer = Buffer.from(actual, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export function guestOrderCookieValue(orderId: string, token: string): string {
  return `${orderId}.${normalizeGuestAccessToken(token)}`;
}

export function parseGuestOrderCookie(
  value: string | null | undefined,
): { orderId: string; token: string } | null {
  if (!value) return null;
  const separator = value.indexOf(".");
  if (separator < 1) return null;
  const orderId = value.slice(0, separator);
  const token = normalizeGuestAccessToken(value.slice(separator + 1));
  return orderId && token ? { orderId, token } : null;
}

async function issueAccessToken(
  sql: Sql,
  orderId: string,
  token: string,
  issuedAt: Date,
  expiresAt = new Date(issuedAt.getTime() + GUEST_ACCESS_TOKEN_TTL_MS),
): Promise<void> {
  if (expiresAt.getTime() <= issuedAt.getTime()) {
    throw new IdempotencyReplayExpiredError();
  }
  await sql`
    insert into order_access_tokens (
      id, order_id, token_hash, token_ciphertext, issued_at, expires_at, revoked_at
    ) values (
      ${randomUUID()}, ${orderId}, ${hashGuestAccessToken(token)},
      ${encryptGuestAccessToken(orderId, token)}, ${issuedAt.toISOString()},
      ${expiresAt.toISOString()}, null
    )
  `;
}

type ReplayAccessTokenState =
  | { kind: "active"; token: string }
  | { kind: "legacy"; id: string; expiresAt: Date }
  | { kind: "expired" }
  | { kind: "missing" }
  | { kind: "corrupt" };

async function replayAccessTokenState(
  sql: Sql,
  orderId: string,
): Promise<ReplayAccessTokenState> {
  const rows = await sql<{
    id: string;
    token_hash: string;
    token_ciphertext: string | null;
    expires_at: Date | string;
    active: boolean;
  }>`
    select id, token_hash, token_ciphertext, expires_at,
      (revoked_at is null and expires_at > now()) as active
    from order_access_tokens
    where order_id = ${orderId}
    order by (revoked_at is null and expires_at > now()) desc, issued_at desc
    limit 1
  `;
  const row = rows[0];
  if (!row) return { kind: "missing" };
  if (!row.active) return { kind: "expired" };
  if (!row.token_ciphertext) {
    return {
      kind: "legacy",
      id: row.id,
      expiresAt: new Date(row.expires_at),
    };
  }
  const decrypted = decryptGuestAccessToken(orderId, row.token_ciphertext);
  if (
    !decrypted ||
    !hashMatches(hashGuestAccessToken(decrypted.token), row.token_hash)
  ) {
    return { kind: "corrupt" };
  }
  if (decrypted.keyIndex > 0) {
    await sql`
      update order_access_tokens
      set token_ciphertext = ${encryptGuestAccessToken(orderId, decrypted.token)}
      where id = ${row.id}
        and token_ciphertext = ${row.token_ciphertext}
    `;
  }
  await sql`
    update order_access_tokens
    set revoked_at = now()
    where order_id = ${orderId}
      and id <> ${row.id}
      and revoked_at is null
      and expires_at > now()
  `;
  return { kind: "active", token: decrypted.token };
}

async function replaceLegacyAccessToken(
  sql: Sql,
  orderId: string,
  legacy: Extract<ReplayAccessTokenState, { kind: "legacy" }>,
): Promise<string> {
  const issuedAt = new Date();
  if (legacy.expiresAt.getTime() <= issuedAt.getTime()) {
    throw new IdempotencyReplayExpiredError();
  }
  const revoked = await sql<{ id: string }>`
    update order_access_tokens
    set revoked_at = ${issuedAt.toISOString()}
    where order_id = ${orderId}
      and revoked_at is null
      and expires_at > ${issuedAt.toISOString()}
    returning id
  `;
  if (!revoked.some((row) => row.id === legacy.id)) {
    throw new IdempotencyReplayExpiredError();
  }
  const token = generateGuestAccessToken();
  await issueAccessToken(sql, orderId, token, issuedAt, legacy.expiresAt);
  return token;
}

async function hasValidAccessToken(
  sql: Sql,
  orderId: string,
  token: string | null | undefined,
): Promise<boolean> {
  if (!token) return false;
  const rows = await sql<{ allowed: boolean }>`
    select true as allowed
    from order_access_tokens
    where order_id = ${orderId}
      and token_hash = ${hashGuestAccessToken(token)}
      and revoked_at is null
      and expires_at > now()
    limit 1
  `;
  return rows[0]?.allowed === true;
}

function asIsoString(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function toPublicOrder(
  row: OrderRow,
  lines: OrderLineRow[],
  shipment: ShipmentRow | null,
): PublicOrder {
  return {
    id: row.id,
    orderNumber: row.order_number,
    email: row.email,
    name: row.name,
    phone: row.phone,
    street: row.street,
    houseNumber: row.house_number,
    postcode: row.postcode,
    city: row.city,
    country: row.country,
    status: row.status,
    subtotalCents: row.subtotal_cents,
    stackDiscountCents: row.stack_discount_cents,
    codeDiscountCents: row.code_discount_cents,
    shippingCents: row.shipping_cents,
    totalCents: row.total_cents,
    discountCode: row.discount_code,
    note: row.note,
    createdAt: asIsoString(row.created_at),
    updatedAt: asIsoString(row.updated_at),
    lines: lines.map((line) => ({
      id: line.id,
      slug: line.slug,
      optionId: line.option_id,
      name: line.name,
      optionLabel: line.option_label,
      unitPriceCents: line.unit_price_cents,
      qty: line.qty,
      lineTotalCents: line.line_total_cents,
    })),
    tracking: shipment
      ? {
          barcode: shipment.barcode,
          trackingUrl: shipment.tracking_url,
          trackingStatus: shipment.tracking_status,
          lastSyncedAt: shipment.last_synced_at
            ? asIsoString(shipment.last_synced_at)
            : null,
        }
      : null,
  };
}

async function loadLatestShipment(
  sql: Sql,
  orderId: string,
): Promise<ShipmentRow | null> {
  const rows = await sql<ShipmentRow>`
    select id, creation_status, provider_shipment_id, carrier_id, barcode,
      tracking_url, provider_status_code, tracking_status, label_status,
      label_requested_at, last_synced_at, created_at, updated_at
    from order_shipments
    where order_id = ${orderId}
    order by created_at desc, id desc
    limit 1
  `;
  return rows[0] ?? null;
}

async function loadLatestCreatedShipment(
  sql: Sql,
  orderId: string,
): Promise<ShipmentRow | null> {
  const rows = await sql<ShipmentRow>`
    select id, creation_status, provider_shipment_id, carrier_id, barcode,
      tracking_url, provider_status_code, tracking_status, label_status,
      label_requested_at, last_synced_at, created_at, updated_at
    from order_shipments
    where order_id = ${orderId}
      and creation_status = 'created'
    order by created_at desc, id desc
    limit 1
  `;
  return rows[0] ?? null;
}

async function loadOrderById(sql: Sql, id: string): Promise<OrderRow | null> {
  const rows = await sql<OrderRow>`
    select id, order_number, user_id, email, name, phone, street, house_number,
      postcode, city, country, status, subtotal_cents, stack_discount_cents,
      code_discount_cents, shipping_cents, total_cents, discount_code, note,
      idempotency_payload_hash, idempotency_viewer_hash,
      address_validation_provider, address_validation_status,
      address_validation_fingerprint, address_validated_at,
      created_at, updated_at
    from orders
    where id = ${id}
    limit 1
  `;
  return rows[0] ?? null;
}

async function loadOrderByNumber(
  sql: Sql,
  orderNumber: string,
): Promise<OrderRow | null> {
  const rows = await sql<OrderRow>`
    select id, order_number, user_id, email, name, phone, street, house_number,
      postcode, city, country, status, subtotal_cents, stack_discount_cents,
      code_discount_cents, shipping_cents, total_cents, discount_code, note,
      idempotency_payload_hash, idempotency_viewer_hash,
      address_validation_provider, address_validation_status,
      address_validation_fingerprint, address_validated_at,
      created_at, updated_at
    from orders
    where order_number = ${orderNumber.trim().toUpperCase()}
    limit 1
  `;
  return rows[0] ?? null;
}

async function loadPublicOrder(sql: Sql, row: OrderRow): Promise<PublicOrder> {
  const [lines, shipment] = await Promise.all([
    sql<OrderLineRow>`
      select id, slug, option_id, name, option_label, unit_price_cents, qty,
        line_total_cents
      from order_lines
      where order_id = ${row.id}
      order by id
    `,
    loadLatestCreatedShipment(sql, row.id),
  ]);
  return toPublicOrder(row, lines, shipment);
}

async function loadFulfillmentLines(
  sql: Sql,
  orderId: string,
): Promise<PublicFulfillmentLine[]> {
  const rows = await sql<FulfillmentLineRow>`
    select id, slug, option_id, name, option_label, qty
    from order_fulfillment_lines
    where order_id = ${orderId}
    order by created_at, id
  `;
  return rows.map((line) => ({
    id: line.id,
    slug: line.slug,
    optionId: line.option_id,
    name: line.name,
    optionLabel: line.option_label,
    qty: line.qty,
  }));
}

async function loadAdminOrder(sql: Sql, row: OrderRow): Promise<AdminOrder> {
  const [order, fulfillmentLines, shipment] = await Promise.all([
    loadPublicOrder(sql, row),
    loadFulfillmentLines(sql, row.id),
    loadLatestShipment(sql, row.id),
  ]);
  return {
    ...order,
    fulfillmentLines,
    addressValidationStatus: row.address_validation_status,
    shipment: shipment
      ? {
          id: shipment.id,
          creationStatus: shipment.creation_status,
          providerShipmentId: shipment.provider_shipment_id,
          carrierId: shipment.carrier_id,
          barcode: shipment.barcode,
          trackingUrl: shipment.tracking_url,
          providerStatusCode: shipment.provider_status_code,
          trackingStatus: shipment.tracking_status,
          labelStatus: shipment.label_status,
          labelRequestedAt: shipment.label_requested_at
            ? asIsoString(shipment.label_requested_at)
            : null,
          lastSyncedAt: shipment.last_synced_at
            ? asIsoString(shipment.last_synced_at)
            : null,
          createdAt: asIsoString(shipment.created_at),
          updatedAt: asIsoString(shipment.updated_at),
        }
      : null,
  };
}

function orderAddress(order: PublicOrder) {
  return {
    name: order.name,
    street: order.street,
    houseNumber: order.houseNumber,
    postcode: order.postcode,
    city: order.city,
    country: order.country,
  };
}

async function writeOrderEvent(
  sql: Sql,
  input: {
    id: string;
    orderId: string;
    type:
      | "order_created"
      | "products_changed"
      | "address_changed"
      | "status_changed";
    dedupeKey: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  await sql`
    insert into order_events (
      id, order_id, event_type, dedupe_key, actor_type, payload, created_at
    ) values (
      ${input.id}, ${input.orderId}, ${input.type}, ${input.dedupeKey},
      ${input.type === "order_created" ? "system" : "admin"},
      ${JSON.stringify(input.payload)}::jsonb, now()
    )
    on conflict (dedupe_key) do nothing
  `;
}

async function queueNewOrderMail(
  sql: Sql,
  order: PublicOrder,
  orderEventId: string,
  hasAccount: boolean,
): Promise<void> {
  const customerMail = orderCustomerConfirmationMail({
    orderNumber: order.orderNumber,
    name: order.name,
    lines: order.lines,
    totalCents: order.totalCents,
    address: orderAddress(order),
    hasAccount,
  });
  const ownerMail = orderOwnerConfirmationMail({
    orderNumber: order.orderNumber,
    email: order.email,
    phone: order.phone,
    lines: order.lines,
    totalCents: order.totalCents,
    address: orderAddress(order),
  });
  await queueTransactionalMail(sql, {
    dedupeKey: `order:${order.id}:confirmation:customer`,
    kind: "order_confirmation_customer",
    to: order.email,
    ...customerMail,
    orderId: order.id,
    orderEventId,
  });
  await queueTransactionalMail(sql, {
    dedupeKey: `order:${order.id}:confirmation:owner`,
    kind: "order_confirmation_owner",
    to: resolveMailOwnerAddress(),
    replyTo: order.email,
    ...ownerMail,
    orderId: order.id,
    orderEventId,
  });
}

async function queueOrderChangeMail(
  sql: Sql,
  input: {
    eventId: string;
    order: PublicOrder;
    kind:
      | "order_status_changed_customer"
      | "order_address_changed_customer"
      | "order_products_changed_customer";
    mail: { subject: string; textBody: string; htmlBody: string };
  },
): Promise<void> {
  await queueTransactionalMail(sql, {
    dedupeKey: `order-event:${input.eventId}:customer`,
    kind: input.kind,
    to: input.order.email,
    ...input.mail,
    orderId: input.order.id,
    orderEventId: input.eventId,
  });
}

async function replayExistingOrder(
  sql: Sql,
  idempotencyKey: string,
  payloadHash: string,
  viewerHash: string,
): Promise<{ order: PublicOrder; guestAccessToken: string } | null> {
  const rows = await sql<{
    id: string;
    idempotency_payload_hash: string | null;
    idempotency_viewer_hash: string | null;
  }>`
    select id, idempotency_payload_hash, idempotency_viewer_hash
    from orders
    where idempotency_key = ${idempotencyKey}
    limit 1
    for update
  `;
  const existing = rows[0];
  if (!existing) return null;
  if (
    !hashMatches(payloadHash, existing.idempotency_payload_hash) ||
    !hashMatches(viewerHash, existing.idempotency_viewer_hash)
  ) {
    throw new IdempotencyConflictError();
  }
  const tokenState = await replayAccessTokenState(sql, existing.id);
  let guestAccessToken: string;
  switch (tokenState.kind) {
    case "active":
      guestAccessToken = tokenState.token;
      break;
    case "legacy":
      // Legacy hashes cannot reveal the original proof. Replace it once, under
      // the order lock, but never extend the original access deadline.
      guestAccessToken = await replaceLegacyAccessToken(
        sql,
        existing.id,
        tokenState,
      );
      break;
    case "expired":
      throw new IdempotencyReplayExpiredError();
    case "missing":
    case "corrupt":
      // Missing/undecryptable ciphertext is an operational incident, not a
      // legacy row. Fail without revoking the still-valid hashed proof.
      throw new IdempotencyReplayUnavailableError();
  }
  const row = await loadOrderById(sql, existing.id);
  return row
    ? { order: await loadPublicOrder(sql, row), guestAccessToken }
    : null;
}

function uniqueConstraint(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const value = error as {
    code?: string;
    constraint?: string;
    message?: string;
  };
  if (value.code !== "23505") return "";
  return `${value.constraint ?? ""} ${value.message ?? ""}`.toLowerCase();
}

async function createNewOrder(
  sql: Sql,
  input: CreateOrderInput,
  userId: string | null,
  payloadHash: string,
  viewerHash: string,
  guestAccessToken: string,
  issuedAt: Date,
): Promise<PublicOrder> {
  const addressValidation = verifyAddressValidationToken(
    input.addressValidationToken,
    {
      street: input.street,
      houseNumber: input.houseNumber,
      postcode: input.postcode,
      city: input.city,
      country: input.country,
    },
    { now: issuedAt },
  );
  const pricing = await calculatePricing(
    { lines: input.lines, discountCode: input.discountCode },
    async (code) => {
      const rows = await sql<DiscountCodeRecord>`
        select code, percent, active
        from discount_codes
        where code = ${code}
        limit 1
      `;
      return rows[0] ?? null;
    },
  );

  const customerId = randomUUID();
  const customers = await sql<{ id: string }>`
    insert into customers (id, email, name, phone, created_at, updated_at)
    values (${customerId}, ${input.email}, ${input.name}, ${input.phone ?? null}, now(), now())
    on conflict (email) do update
      set name = excluded.name,
          phone = coalesce(excluded.phone, customers.phone),
          updated_at = now()
    returning id
  `;
  const customer = customers[0];
  if (!customer) throw new Error("Klant kon niet worden opgeslagen.");

  const orderId = randomUUID();
  const orderNumberValues = await sql<{ value: number }>`
    update order_number_counters
    set next_value = next_value + 2
    where key = 'med'
    returning next_value - 2 as value
  `;
  const orderNumberValue = orderNumberValues[0]?.value;
  if (!Number.isInteger(orderNumberValue)) {
    throw new Error("Bestelnummer kon niet worden aangemaakt.");
  }
  const orderNumber = `MED-${orderNumberValue}`;
  await sql`
    insert into orders (
      id, order_number, idempotency_key, idempotency_payload_hash,
      idempotency_viewer_hash, customer_id, user_id, email, name, phone, street,
      house_number, postcode, city, country, status, subtotal_cents,
      stack_discount_cents, code_discount_cents, shipping_cents, total_cents,
      discount_code, note, address_validation_provider,
      address_validation_status, address_validation_fingerprint,
      address_validated_at, created_at, updated_at
    ) values (
      ${orderId}, ${orderNumber}, ${input.idempotencyKey}, ${payloadHash},
      ${viewerHash}, ${customer.id}, ${userId}, ${input.email}, ${input.name},
      ${input.phone ?? null}, ${input.street}, ${input.houseNumber},
      ${input.postcode}, ${input.city}, ${input.country}, 'pending',
      ${pricing.subtotalCents}, ${pricing.stackDiscountCents},
      ${pricing.codeDiscountCents}, ${pricing.shippingCents},
      ${pricing.totalCents}, ${pricing.discountCode}, ${input.note ?? null},
      ${addressValidation.provider}, 'valid', ${addressValidation.fingerprint},
      ${addressValidation.validatedAt.toISOString()}, now(), now()
    )
  `;

  for (const line of pricing.lines) {
    const orderLineId = randomUUID();
    await sql`
      insert into order_lines (
        id, order_id, slug, option_id, name, option_label, unit_price_cents, qty,
        line_total_cents
      ) values (
        ${orderLineId}, ${orderId}, ${line.slug}, ${line.optionId}, ${line.name},
        ${line.optionLabel}, ${line.unitPriceCents}, ${line.qty},
        ${line.lineTotalCents}
      )
    `;
    await sql`
      insert into order_fulfillment_lines (
        id, order_id, source_order_line_id, slug, option_id, name,
        option_label, qty, created_at, updated_at
      ) values (
        ${randomUUID()}, ${orderId}, ${orderLineId}, ${line.slug},
        ${line.optionId}, ${line.name}, ${line.optionLabel}, ${line.qty},
        now(), now()
      )
    `;
  }
  await issueAccessToken(sql, orderId, guestAccessToken, issuedAt);

  const row = await loadOrderById(sql, orderId);
  if (!row) throw new Error("Bestelling kon niet worden opgeslagen.");
  const order = await loadPublicOrder(sql, row);
  const eventId = randomUUID();
  await writeOrderEvent(sql, {
    id: eventId,
    orderId,
    type: "order_created",
    dedupeKey: `order:${orderId}:created`,
    payload: { orderNumber },
  });
  await queueNewOrderMail(sql, order, eventId, Boolean(userId));
  return order;
}

export async function createOrderRecord(
  rawInput: CreateOrderInput,
  viewer: { userId?: string | null } = {},
): Promise<CreateOrderRecordResult> {
  const input = createOrderSchema.parse(rawInput);
  const userId = viewer.userId ?? null;
  const payloadHash = canonicalPayloadHash(input);
  const viewerHash = viewerBindingHash(input, userId);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await withSqlTransaction(async (sql) => {
        const replay = await replayExistingOrder(
          sql,
          input.idempotencyKey,
          payloadHash,
          viewerHash,
        );
        if (replay) return { ...replay, replayed: true };
        const guestAccessToken = generateGuestAccessToken();
        const order = await createNewOrder(
          sql,
          input,
          userId,
          payloadHash,
          viewerHash,
          guestAccessToken,
          new Date(),
        );
        return { order, guestAccessToken, replayed: false };
      });
      return result;
    } catch (error) {
      const constraint = uniqueConstraint(error);
      if (constraint.includes("idempotency")) {
        const replay = await withSqlTransaction((sql) =>
          replayExistingOrder(
            sql,
            input.idempotencyKey,
            payloadHash,
            viewerHash,
          ),
        );
        if (replay) {
          return { ...replay, replayed: true };
        }
      }
      if (constraint.includes("order_number") && attempt < 2) continue;
      throw error;
    }
  }

  throw new Error("Bestelling kon niet worden opgeslagen.");
}

export async function getOrderRecordForViewer(
  viewer: OrderViewer,
): Promise<PublicOrder> {
  const sql = await getSql();
  const row = viewer.id
    ? await loadOrderById(sql, viewer.id)
    : viewer.orderNumber
      ? await loadOrderByNumber(sql, viewer.orderNumber)
      : null;
  if (!row) throw new OrderAccessError();

  const isOwner = Boolean(viewer.userId && row.user_id === viewer.userId);
  if (!viewer.isAdmin && !isOwner) {
    const cookieMatches =
      viewer.cookieOrderId === row.id &&
      (await hasValidAccessToken(sql, row.id, viewer.cookieAccessToken));
    if (!cookieMatches) throw new OrderAccessError();
  }

  return loadPublicOrder(sql, row);
}

export async function listOwnOrderRecords(
  userId: string,
): Promise<OrderSummary[]> {
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    order_number: string;
    name: string;
    email: string;
    status: OrderStatus;
    total_cents: number;
    created_at: Date | string;
  }>`
    select id, order_number, name, email, status, total_cents, created_at
    from orders
    where user_id = ${userId}
    order by created_at desc
    limit 100
  `;
  return rows.map((row) => ({
    id: row.id,
    orderNumber: row.order_number,
    name: row.name,
    email: row.email,
    status: row.status,
    totalCents: row.total_cents,
    createdAt: asIsoString(row.created_at),
  }));
}

export type AdminOrderListInput = {
  search?: string;
  status?: OrderStatus | "all";
  page?: number;
  pageSize?: number;
};

export type AdminOrderListResult = {
  orders: OrderSummary[];
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
};

export async function listAdminOrderRecords(
  input: AdminOrderListInput,
): Promise<AdminOrderListResult> {
  const sql = await getSql();
  const page = Math.max(1, Math.trunc(input.page ?? 1));
  const pageSize = Math.min(50, Math.max(1, Math.trunc(input.pageSize ?? 20)));
  const clauses: string[] = [];
  const params: unknown[] = [];
  const search = input.search?.trim();
  if (search) {
    params.push(`%${search}%`);
    clauses.push(
      `(order_number ilike $${params.length} or name ilike $${params.length} or email ilike $${params.length})`,
    );
  }
  if (input.status && input.status !== "all") {
    params.push(input.status);
    clauses.push(`status = $${params.length}`);
  }
  const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
  const counts = await sql.query<{ count: number }>(
    `select count(*)::int as count from orders ${where}`,
    params,
  );
  const total = counts[0]?.count ?? 0;
  params.push(pageSize, (page - 1) * pageSize);
  const rows = await sql.query<{
    id: string;
    order_number: string;
    name: string;
    email: string;
    status: OrderStatus;
    total_cents: number;
    created_at: Date | string;
  }>(
    `select id, order_number, name, email, status, total_cents, created_at
     from orders
     ${where}
     order by created_at desc
     limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  return {
    orders: rows.map((row) => ({
      id: row.id,
      orderNumber: row.order_number,
      name: row.name,
      email: row.email,
      status: row.status,
      totalCents: row.total_cents,
      createdAt: asIsoString(row.created_at),
    })),
    page,
    pageSize,
    total,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getAdminOrderRecord(id: string): Promise<AdminOrder> {
  const sql = await getSql();
  const row = await loadOrderById(sql, id);
  if (!row) throw new OrderAccessError();
  return loadAdminOrder(sql, row);
}

export async function updateOrderStatusRecord(
  id: string,
  expectedStatus: OrderStatus,
  status: OrderStatus,
): Promise<AdminOrder> {
  if (
    !ORDER_STATUSES.includes(expectedStatus) ||
    !ORDER_STATUSES.includes(status)
  ) {
    throw new Error("Ongeldige bestelstatus.");
  }
  if (!isOrderStatusTransitionAllowed(expectedStatus, status)) {
    throw new OrderStatusTransitionError();
  }
  return withSqlTransaction(async (sql) => {
    const currentRows = await sql<{ status: OrderStatus }>`
      select status
      from orders
      where id = ${id}
      limit 1
      for update
    `;
    const current = currentRows[0];
    if (!current) throw new OrderAccessError();
    if (current.status !== expectedStatus) {
      throw new OrderStatusConflictError();
    }

    // Label requests claim order -> shipment in this same order. An active
    // external request therefore makes the status mutation fail quickly after
    // the short claim transaction, without holding a DB lock during network
    // I/O. A stale claim is invalidated so its late response cannot win its CAS.
    const shipmentRows = await sql<{
      id: string;
      label_status: string;
      label_requested_at: Date | string | null;
    }>`
      select id, label_status, label_requested_at
      from order_shipments
      where order_id = ${id}
      order by created_at desc, id desc
      limit 1
      for update
    `;
    const shipment = shipmentRows[0];
    if (shipment?.label_status === "requested") {
      if (labelClaimIsActive(shipment.label_requested_at)) {
        throw new OrderStatusConflictError();
      }
      await sql`
        update order_shipments
        set label_status = 'failed', label_requested_at = null,
            updated_at = now()
        where id = ${shipment.id} and label_status = 'requested'
      `;
    }

    const updated = await sql<{ id: string }>`
      update orders
      set status = ${status}, updated_at = now()
      where id = ${id} and status = ${expectedStatus}
      returning id
    `;
    if (!updated[0]) {
      const existing = await sql<{ id: string }>`
        select id from orders where id = ${id} limit 1
      `;
      if (!existing[0]) throw new OrderAccessError();
      throw new OrderStatusConflictError();
    }
    const row = await loadOrderById(sql, id);
    if (!row) throw new OrderAccessError();
    const order = await loadPublicOrder(sql, row);
    const eventId = randomUUID();
    await writeOrderEvent(sql, {
      id: eventId,
      orderId: id,
      type: "status_changed",
      dedupeKey: `order:${id}:status:${eventId}`,
      payload: { previousStatus: expectedStatus, nextStatus: status },
    });
    await queueOrderChangeMail(sql, {
      eventId,
      order,
      kind: "order_status_changed_customer",
      mail: orderStatusChangedMail({
        orderNumber: order.orderNumber,
        name: order.name,
        status,
      }),
    });
    return loadAdminOrder(sql, row);
  });
}

const ADDRESS_FIELDS = [
  "name",
  "phone",
  "street",
  "houseNumber",
  "postcode",
  "city",
  "country",
] as const;

const PHYSICAL_ADDRESS_FIELDS = [
  "street",
  "houseNumber",
  "postcode",
  "city",
  "country",
] as const;

function sameVersion(actual: Date | string, expected: string): boolean {
  return asIsoString(actual) === new Date(expected).toISOString();
}

export async function updateOrderAddressRecord(
  rawInput: UpdateOrderAddressInput,
): Promise<AdminOrder> {
  const input = updateOrderAddressSchema.parse(rawInput);
  return withSqlTransaction(async (sql) => {
    const rows = await sql<OrderRow>`
      select id, order_number, user_id, email, name, phone, street, house_number,
        postcode, city, country, status, subtotal_cents, stack_discount_cents,
        code_discount_cents, shipping_cents, total_cents, discount_code, note,
        idempotency_payload_hash, idempotency_viewer_hash,
        address_validation_provider, address_validation_status,
        address_validation_fingerprint, address_validated_at,
        created_at, updated_at
      from orders
      where id = ${input.id}
      limit 1
      for update
    `;
    const current = rows[0];
    if (!current) throw new OrderAccessError();
    if (!sameVersion(current.updated_at, input.expectedUpdatedAt)) {
      throw new OrderUpdateConflictError();
    }

    const before = {
      name: current.name,
      phone: current.phone,
      street: current.street,
      houseNumber: current.house_number,
      postcode: current.postcode,
      city: current.city,
      country: current.country,
    };
    const after = {
      name: input.name,
      phone: input.phone ?? null,
      street: input.street,
      houseNumber: input.houseNumber,
      postcode: input.postcode,
      city: input.city,
      country: input.country,
    };
    const changedFields = ADDRESS_FIELDS.filter(
      (field) => before[field] !== after[field],
    );
    const physicalAddressChanged = PHYSICAL_ADDRESS_FIELDS.some(
      (field) => before[field] !== after[field],
    );
    const addressValidation = input.addressValidationToken
      ? verifyAddressValidationToken(input.addressValidationToken, after)
      : null;
    if (!changedFields.length) {
      if (
        !addressValidation ||
        (current.address_validation_status === "valid" &&
          current.address_validation_fingerprint ===
            addressValidation.fingerprint)
      ) {
        return loadAdminOrder(sql, current);
      }
      const validated = await sql<{ updated_at: Date | string }>`
        update orders
        set address_validation_provider = ${addressValidation.provider},
            address_validation_status = 'valid',
            address_validation_fingerprint = ${addressValidation.fingerprint},
            address_validated_at = ${addressValidation.validatedAt.toISOString()},
            updated_at = now()
        where id = ${input.id} and updated_at = ${input.expectedUpdatedAt}
        returning updated_at
      `;
      if (!validated[0]) throw new OrderUpdateConflictError();
      const row = await loadOrderById(sql, input.id);
      if (!row) throw new OrderAccessError();
      return loadAdminOrder(sql, row);
    }
    const existingShipment = await sql<{ id: string }>`
      select id
      from order_shipments
      where order_id = ${input.id}
        and creation_status in ('pending', 'ambiguous', 'created')
      limit 1
    `;
    if (existingShipment[0]) throw new OrderAddressLockedError();

    const nextValidationProvider = addressValidation
      ? addressValidation.provider
      : physicalAddressChanged
        ? null
        : current.address_validation_provider;
    const nextValidationStatus = addressValidation
      ? "valid"
      : physicalAddressChanged
        ? "unvalidated"
        : current.address_validation_status;
    const nextValidationFingerprint = addressValidation
      ? addressValidation.fingerprint
      : physicalAddressChanged
        ? null
        : current.address_validation_fingerprint;
    const nextValidatedAt = addressValidation
      ? addressValidation.validatedAt.toISOString()
      : physicalAddressChanged
        ? null
        : current.address_validated_at;

    const updated = await sql<{ updated_at: Date | string }>`
      update orders
      set name = ${after.name}, phone = ${after.phone}, street = ${after.street},
          house_number = ${after.houseNumber}, postcode = ${after.postcode},
          city = ${after.city}, country = ${after.country},
          address_validation_provider = ${nextValidationProvider},
          address_validation_status = ${nextValidationStatus},
          address_validation_fingerprint = ${nextValidationFingerprint},
          address_validated_at = ${nextValidatedAt},
          updated_at = now()
      where id = ${input.id} and updated_at = ${input.expectedUpdatedAt}
      returning updated_at
    `;
    if (!updated[0]) throw new OrderUpdateConflictError();
    const row = await loadOrderById(sql, input.id);
    if (!row) throw new OrderAccessError();
    const order = await loadPublicOrder(sql, row);
    const eventId = randomUUID();
    await writeOrderEvent(sql, {
      id: eventId,
      orderId: input.id,
      type: "address_changed",
      dedupeKey: `order:${input.id}:address:${eventId}`,
      payload: { changedFields, before, after },
    });
    await queueOrderChangeMail(sql, {
      eventId,
      order,
      kind: "order_address_changed_customer",
      mail: orderAddressChangedMail({
        orderNumber: order.orderNumber,
        name: order.name,
        address: orderAddress(order),
      }),
    });
    return loadAdminOrder(sql, row);
  });
}

function normalizeFulfillmentLines(
  lines: UpdateOrderFulfillmentInput["lines"],
): Array<Omit<PublicFulfillmentLine, "id">> {
  return lines.map((line) => {
    const product = getProduct(line.slug);
    if (!product) {
      throw new OrderFulfillmentError("Een gekozen product bestaat niet.");
    }
    const hasValidOption = product.options.length
      ? product.options.some((option) => option.id === line.optionId)
      : line.optionId === "default";
    if (!hasValidOption) {
      throw new OrderFulfillmentError(
        `De gekozen optie voor ${product.name} bestaat niet.`,
      );
    }
    return {
      slug: product.slug,
      optionId: line.optionId,
      name: product.name,
      optionLabel: getOption(product, line.optionId)?.label ?? product.unit,
      qty: line.qty,
    };
  });
}

function canonicalFulfillmentLines(
  lines: ReadonlyArray<Omit<PublicFulfillmentLine, "id">>,
): string {
  return JSON.stringify(
    [...lines]
      .map(({ slug, optionId, name, optionLabel, qty }) => ({
        slug,
        optionId,
        name,
        optionLabel,
        qty,
      }))
      .sort((left, right) =>
        `${left.slug}\0${left.optionId}`.localeCompare(
          `${right.slug}\0${right.optionId}`,
        ),
      ),
  );
}

export async function updateOrderFulfillmentRecord(
  rawInput: UpdateOrderFulfillmentInput,
): Promise<AdminOrder> {
  const input = updateOrderFulfillmentSchema.parse(rawInput);
  const nextLines = normalizeFulfillmentLines(input.lines);
  return withSqlTransaction(async (sql) => {
    const rows = await sql<OrderRow>`
      select id, order_number, user_id, email, name, phone, street, house_number,
        postcode, city, country, status, subtotal_cents, stack_discount_cents,
        code_discount_cents, shipping_cents, total_cents, discount_code, note,
        idempotency_payload_hash, idempotency_viewer_hash,
        address_validation_provider, address_validation_status,
        address_validation_fingerprint, address_validated_at,
        created_at, updated_at
      from orders
      where id = ${input.id}
      limit 1
      for update
    `;
    const current = rows[0];
    if (!current) throw new OrderAccessError();
    if (!sameVersion(current.updated_at, input.expectedUpdatedAt)) {
      throw new OrderUpdateConflictError();
    }
    const currentLines = await loadFulfillmentLines(sql, input.id);
    if (
      canonicalFulfillmentLines(currentLines) ===
      canonicalFulfillmentLines(nextLines)
    ) {
      return loadAdminOrder(sql, current);
    }

    if (current.status === "shipped" || current.status === "cancelled") {
      throw new OrderFulfillmentLockedError();
    }
    const lockedShipments = await sql<{ id: string }>`
      select id
      from order_shipments
      where order_id = ${input.id}
        and (
          label_requested_at is not null
          or label_status <> 'not_requested'
          or tracking_status in (
            'handed_over', 'in_transit', 'delivered', 'exception', 'returned',
            'unknown'
          )
        )
      limit 1
      for update
    `;
    if (lockedShipments[0]) throw new OrderFulfillmentLockedError();

    const historicalSources = await sql<{
      id: string;
      slug: string;
      option_id: string;
    }>`
      select id, slug, option_id
      from order_lines
      where order_id = ${input.id}
    `;
    const sourceByVariant = new Map(
      historicalSources.map((line) => [
        `${line.slug}\0${line.option_id}`,
        line.id,
      ]),
    );
    await sql`
      delete from order_fulfillment_lines
      where order_id = ${input.id}
    `;
    for (const line of nextLines) {
      await sql`
        insert into order_fulfillment_lines (
          id, order_id, source_order_line_id, slug, option_id, name,
          option_label, qty, created_at, updated_at
        ) values (
          ${randomUUID()}, ${input.id},
          ${sourceByVariant.get(`${line.slug}\0${line.optionId}`) ?? null},
          ${line.slug}, ${line.optionId}, ${line.name}, ${line.optionLabel},
          ${line.qty}, now(), now()
        )
      `;
    }
    const updated = await sql<{ updated_at: Date | string }>`
      update orders
      set updated_at = now()
      where id = ${input.id} and updated_at = ${input.expectedUpdatedAt}
      returning updated_at
    `;
    if (!updated[0]) throw new OrderUpdateConflictError();
    const row = await loadOrderById(sql, input.id);
    if (!row) throw new OrderAccessError();
    const order = await loadPublicOrder(sql, row);
    const fulfillmentLines = await loadFulfillmentLines(sql, input.id);
    const eventId = randomUUID();
    await writeOrderEvent(sql, {
      id: eventId,
      orderId: input.id,
      type: "products_changed",
      dedupeKey: `order:${input.id}:products:${eventId}`,
      payload: {
        before: currentLines.map(
          ({ slug, optionId, name, optionLabel, qty }) => ({
            slug,
            optionId,
            name,
            optionLabel,
            qty,
          }),
        ),
        after: nextLines,
      },
    });
    await queueOrderChangeMail(sql, {
      eventId,
      order,
      kind: "order_products_changed_customer",
      mail: orderProductsChangedMail({
        orderNumber: order.orderNumber,
        name: order.name,
        lines: fulfillmentLines,
        paidTotalCents: order.totalCents,
      }),
    });
    return loadAdminOrder(sql, row);
  });
}
