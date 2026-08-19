import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { getSql, withSqlTransaction, type Sql } from "@/lib/db";
import { canonicalCheckoutPayload } from "@/lib/checkout-idempotency";
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
  type CreateOrderInput,
  type OrderViewerInput,
} from "@/lib/server/order-schema";

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
  idempotency_payload_hash: string | null;
  idempotency_viewer_hash: string | null;
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

function toPublicOrder(row: OrderRow, lines: OrderLineRow[]): PublicOrder {
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
  };
}

async function loadOrderById(sql: Sql, id: string): Promise<OrderRow | null> {
  const rows = await sql<OrderRow>`
    select id, order_number, user_id, email, name, phone, street, house_number,
      postcode, city, country, status, subtotal_cents, stack_discount_cents,
      code_discount_cents, shipping_cents, total_cents, discount_code, note,
      idempotency_payload_hash, idempotency_viewer_hash, created_at, updated_at
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
      idempotency_payload_hash, idempotency_viewer_hash, created_at, updated_at
    from orders
    where order_number = ${orderNumber.trim().toUpperCase()}
    limit 1
  `;
  return rows[0] ?? null;
}

async function loadPublicOrder(sql: Sql, row: OrderRow): Promise<PublicOrder> {
  const lines = await sql<OrderLineRow>`
    select id, slug, option_id, name, option_label, unit_price_cents, qty,
      line_total_cents
    from order_lines
    where order_id = ${row.id}
    order by id
  `;
  return toPublicOrder(row, lines);
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
      discount_code, note, created_at, updated_at
    ) values (
      ${orderId}, ${orderNumber}, ${input.idempotencyKey}, ${payloadHash},
      ${viewerHash}, ${customer.id}, ${userId}, ${input.email}, ${input.name},
      ${input.phone ?? null}, ${input.street}, ${input.houseNumber},
      ${input.postcode}, ${input.city}, ${input.country}, 'pending',
      ${pricing.subtotalCents}, ${pricing.stackDiscountCents},
      ${pricing.codeDiscountCents}, ${pricing.shippingCents},
      ${pricing.totalCents}, ${pricing.discountCode}, ${input.note ?? null},
      now(), now()
    )
  `;

  for (const line of pricing.lines) {
    await sql`
      insert into order_lines (
        id, order_id, slug, option_id, name, option_label, unit_price_cents, qty,
        line_total_cents
      ) values (
        ${randomUUID()}, ${orderId}, ${line.slug}, ${line.optionId}, ${line.name},
        ${line.optionLabel}, ${line.unitPriceCents}, ${line.qty},
        ${line.lineTotalCents}
      )
    `;
  }
  await issueAccessToken(sql, orderId, guestAccessToken, issuedAt);

  const row = await loadOrderById(sql, orderId);
  if (!row) throw new Error("Bestelling kon niet worden opgeslagen.");
  return loadPublicOrder(sql, row);
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
    const codeMatches =
      !cookieMatches &&
      (await hasValidAccessToken(sql, row.id, viewer.accessCode));
    if (!cookieMatches && !codeMatches) throw new OrderAccessError();
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

export async function getAdminOrderRecord(id: string): Promise<PublicOrder> {
  const sql = await getSql();
  const row = await loadOrderById(sql, id);
  if (!row) throw new OrderAccessError();
  return loadPublicOrder(sql, row);
}

export async function updateOrderStatusRecord(
  id: string,
  expectedStatus: OrderStatus,
  status: OrderStatus,
): Promise<PublicOrder> {
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
    return loadPublicOrder(sql, row);
  });
}
