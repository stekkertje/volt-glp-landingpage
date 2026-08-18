import { randomUUID } from "node:crypto";
import { getSql } from "@/lib/db";
import {
  contactMessageSchema,
  type ContactListInput,
  type ContactMessageInput,
} from "@/lib/server/contact-schema";

const CONTACT_WINDOW_MS = 10 * 60 * 1_000;
const CONTACT_LIMIT = 8;

const globalContactRef = globalThis as typeof globalThis & {
  __voltContactRateLimit__?: Map<string, number[]>;
};
const contactRateLimit: Map<string, number[]> =
  globalContactRef.__voltContactRateLimit__ ??
  (globalContactRef.__voltContactRateLimit__ = new Map<string, number[]>());

export class ContactRateLimitError extends Error {
  readonly status = 429;

  constructor() {
    super("Probeer het over een paar minuten opnieuw.");
    this.name = "ContactRateLimitError";
  }
}

export type ContactMessage = {
  id: string;
  name: string;
  email: string;
  message: string;
  handled: boolean;
  createdAt: string;
  handledAt: string | null;
};

type ContactRow = {
  id: string;
  name: string;
  email: string;
  message: string;
  handled: boolean;
  created_at: Date | string;
  handled_at: Date | string | null;
};

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toContactMessage(row: ContactRow): ContactMessage {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    message: row.message,
    handled: row.handled,
    createdAt: iso(row.created_at),
    handledAt: row.handled_at ? iso(row.handled_at) : null,
  };
}

function consumeContactRateLimit(key: string, now = Date.now()): void {
  const cutoff = now - CONTACT_WINDOW_MS;
  const recent = (contactRateLimit.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
  if (recent.length >= CONTACT_LIMIT) throw new ContactRateLimitError();
  recent.push(now);
  contactRateLimit.set(key, recent);

  if (contactRateLimit.size > 1_000) {
    for (const [entryKey, timestamps] of contactRateLimit) {
      if (!timestamps.some((timestamp) => timestamp > cutoff)) {
        contactRateLimit.delete(entryKey);
      }
    }
  }
}

export async function storeContactMessage(
  rawInput: ContactMessageInput,
  rateLimitKey: string,
): Promise<void> {
  const input = contactMessageSchema.parse(rawInput);
  consumeContactRateLimit(rateLimitKey);
  const sql = await getSql();
  await sql`
    insert into contact_messages (id, name, email, message, handled, created_at)
    values (${randomUUID()}, ${input.name}, ${input.email}, ${input.message}, false, now())
  `;
}

export async function listContactMessageRecords(input: ContactListInput): Promise<{
  messages: ContactMessage[];
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
}> {
  const sql = await getSql();
  const page = Math.max(1, Math.trunc(input.page ?? 1));
  const pageSize = Math.min(50, Math.max(1, Math.trunc(input.pageSize ?? 20)));
  const params: unknown[] = [];
  const where =
    typeof input.handled === "boolean"
      ? (params.push(input.handled), `where handled = $${params.length}`)
      : "";
  const countRows = await sql.query<{ count: number }>(
    `select count(*)::int as count from contact_messages ${where}`,
    params,
  );
  const total = countRows[0]?.count ?? 0;
  params.push(pageSize, (page - 1) * pageSize);
  const rows = await sql.query<ContactRow>(
    `select id, name, email, message, handled, created_at, handled_at
     from contact_messages
     ${where}
     order by created_at desc
     limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  return {
    messages: rows.map(toContactMessage),
    page,
    pageSize,
    total,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function setContactHandledRecord(
  id: string,
  handled: boolean,
): Promise<ContactMessage> {
  const sql = await getSql();
  const rows = await sql<ContactRow>`
    update contact_messages
    set handled = ${handled}, handled_at = case when ${handled} then now() else null end
    where id = ${id}
    returning id, name, email, message, handled, created_at, handled_at
  `;
  const row = rows[0];
  if (!row) throw new Error("Contactbericht niet gevonden.");
  return toContactMessage(row);
}
