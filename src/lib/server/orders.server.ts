import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { getSql, withSqlTransaction, type Sql } from "@/lib/db";
import { ORDER_STATUSES, type OrderStatus } from "@/lib/order-status";
import { calculatePricing, type DiscountCodeRecord } from "@/lib/server/pricing";
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
  guest_access_token_hash: string | null;
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

export class OrderAccessError extends Error {
  constructor() {
    super(ORDER_ACCESS_ERROR);
    this.name = "OrderAccessError";
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
  return token.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function hashGuestAccessToken(token: string): string {
  return createHash("sha256").update(normalizeGuestAccessToken(token)).digest("hex");
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

function tokenMatches(token: string | null | undefined, storedHash: string | null): boolean {
  if (!token || !storedHash || !/^[a-f0-9]{64}$/i.test(storedHash)) return false;
  const actual = Buffer.from(hashGuestAccessToken(token), "hex");
  const expected = Buffer.from(storedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function asIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
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
      guest_access_token_hash, created_at, updated_at
    from orders
    where id = ${id}
    limit 1
  `;
  return rows[0] ?? null;
}

async function loadOrderByNumber(sql: Sql, orderNumber: string): Promise<OrderRow | null> {
  const rows = await sql<OrderRow>`
    select id, order_number, user_id, email, name, phone, street, house_number,
      postcode, city, country, status, subtotal_cents, stack_discount_cents,
      code_discount_cents, shipping_cents, total_cents, discount_code, note,
      guest_access_token_hash, created_at, updated_at
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

async function rotateExistingOrder(
  sql: Sql,
  idempotencyKey: string,
  tokenHash: string,
): Promise<PublicOrder | null> {
  const rows = await sql<OrderRow>`
    select id, order_number, user_id, email, name, phone, street, house_number,
      postcode, city, country, status, subtotal_cents, stack_discount_cents,
      code_discount_cents, shipping_cents, total_cents, discount_code, note,
      guest_access_token_hash, created_at, updated_at
    from orders
    where idempotency_key = ${idempotencyKey}
    limit 1
  `;
  const existing = rows[0];
  if (!existing) return null;
  await sql`
    update orders
    set guest_access_token_hash = ${tokenHash}, updated_at = now()
    where id = ${existing.id}
  `;
  const refreshed = await loadOrderById(sql, existing.id);
  return refreshed ? loadPublicOrder(sql, refreshed) : null;
}

function uniqueConstraint(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const value = error as { code?: string; constraint?: string; message?: string };
  if (value.code !== "23505") return "";
  return `${value.constraint ?? ""} ${value.message ?? ""}`.toLowerCase();
}

async function createNewOrder(
  sql: Sql,
  input: CreateOrderInput,
  userId: string | null,
  tokenHash: string,
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
  const orderNumber = `VOLT-${randomCharacters(8)}`;
  await sql`
    insert into orders (
      id, order_number, idempotency_key, customer_id, user_id, email, name, phone,
      street, house_number, postcode, city, country, status, subtotal_cents,
      stack_discount_cents, code_discount_cents, shipping_cents, total_cents,
      discount_code, note, guest_access_token_hash, created_at, updated_at
    ) values (
      ${orderId}, ${orderNumber}, ${input.idempotencyKey}, ${customer.id}, ${userId},
      ${input.email}, ${input.name}, ${input.phone ?? null}, ${input.street},
      ${input.houseNumber}, ${input.postcode}, ${input.city}, ${input.country},
      'pending', ${pricing.subtotalCents}, ${pricing.stackDiscountCents},
      ${pricing.codeDiscountCents}, ${pricing.shippingCents}, ${pricing.totalCents},
      ${pricing.discountCode}, ${input.note ?? null}, ${tokenHash}, now(), now()
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

  const row = await loadOrderById(sql, orderId);
  if (!row) throw new Error("Bestelling kon niet worden opgeslagen.");
  return loadPublicOrder(sql, row);
}

export async function createOrderRecord(
  rawInput: CreateOrderInput,
  viewer: { userId?: string | null } = {},
): Promise<CreateOrderRecordResult> {
  const input = createOrderSchema.parse(rawInput);
  const guestAccessToken = generateGuestAccessToken();
  const tokenHash = hashGuestAccessToken(guestAccessToken);
  const userId = viewer.userId ?? null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await withSqlTransaction(async (sql) => {
        const replay = await rotateExistingOrder(sql, input.idempotencyKey, tokenHash);
        if (replay) return { order: replay, replayed: true };
        const order = await createNewOrder(sql, input, userId, tokenHash);
        return { order, replayed: false };
      });
      return { ...result, guestAccessToken };
    } catch (error) {
      const constraint = uniqueConstraint(error);
      if (constraint.includes("idempotency")) {
        const replay = await withSqlTransaction((sql) =>
          rotateExistingOrder(sql, input.idempotencyKey, tokenHash),
        );
        if (replay) {
          return { order: replay, guestAccessToken, replayed: true };
        }
      }
      if (constraint.includes("order_number") && attempt < 2) continue;
      throw error;
    }
  }

  throw new Error("Bestelling kon niet worden opgeslagen.");
}

export async function getOrderRecordForViewer(viewer: OrderViewer): Promise<PublicOrder> {
  const sql = await getSql();
  const row = viewer.id
    ? await loadOrderById(sql, viewer.id)
    : viewer.orderNumber
      ? await loadOrderByNumber(sql, viewer.orderNumber)
      : null;
  if (!row) throw new OrderAccessError();

  const isOwner = Boolean(viewer.userId && row.user_id === viewer.userId);
  const cookieMatches =
    viewer.cookieOrderId === row.id &&
    tokenMatches(viewer.cookieAccessToken, row.guest_access_token_hash);
  const codeMatches = tokenMatches(viewer.accessCode, row.guest_access_token_hash);
  if (!viewer.isAdmin && !isOwner && !cookieMatches && !codeMatches) {
    throw new OrderAccessError();
  }

  return loadPublicOrder(sql, row);
}

export async function listOwnOrderRecords(userId: string): Promise<OrderSummary[]> {
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
  status: OrderStatus,
): Promise<PublicOrder> {
  if (!ORDER_STATUSES.includes(status)) {
    throw new Error("Ongeldige bestelstatus.");
  }
  return withSqlTransaction(async (sql) => {
    const updated = await sql<{ id: string }>`
      update orders
      set status = ${status}, updated_at = now()
      where id = ${id}
      returning id
    `;
    if (!updated[0]) throw new OrderAccessError();
    const row = await loadOrderById(sql, id);
    if (!row) throw new OrderAccessError();
    return loadPublicOrder(sql, row);
  });
}
