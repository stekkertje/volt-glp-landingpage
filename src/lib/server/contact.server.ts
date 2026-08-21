import { createHash, randomUUID } from "node:crypto";
import { getSql, withSqlTransaction } from "@/lib/db";
import {
  contactMessageSchema,
  type ContactListInput,
  type ContactMessageInput,
} from "@/lib/server/contact-schema";
import { enforceContactCreationLimit } from "@/lib/server/abuse-protection.server";
import { resolveMailOwnerAddress } from "@/lib/server/mail/config.server";
import { queueTransactionalMail } from "@/lib/server/mail/outbox.server";
import {
  contactCustomerReceiptMail,
  contactOwnerMail,
} from "@/lib/server/mail/templates";

export type ContactMessage = {
  id: string;
  name: string;
  email: string;
  message: string;
  handled: boolean;
  createdAt: string;
  handledAt: string | null;
};

export class ContactIdempotencyConflictError extends Error {
  readonly status = 409;

  constructor() {
    super("Deze contactaanvraag hoort bij andere gegevens.");
    this.name = "ContactIdempotencyConflictError";
  }
}

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
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
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

export async function storeContactMessage(
  rawInput: ContactMessageInput,
  rateLimitKey: string,
): Promise<{ id: string; replayed: boolean }> {
  const input = contactMessageSchema.parse(rawInput);
  await enforceContactCreationLimit(rateLimitKey);
  const ownerAddress = resolveMailOwnerAddress(process.env);
  const id = randomUUID();
  const payloadHash = createHash("sha256")
    .update(
      JSON.stringify({
        name: input.name,
        email: input.email,
        message: input.message,
      }),
    )
    .digest("hex");
  return withSqlTransaction(async (sql) => {
    const inserted = await sql<{ id: string }>`
      insert into contact_messages (
        id, idempotency_key, idempotency_payload_hash,
        name, email, message, handled, created_at
      ) values (
        ${id}, ${input.idempotencyKey}, ${payloadHash},
        ${input.name}, ${input.email}, ${input.message}, false, now()
      )
      on conflict (idempotency_key) do nothing
      returning id
    `;

    if (!inserted[0]) {
      const existing = await sql<{
        id: string;
        idempotency_payload_hash: string | null;
      }>`
        select id, idempotency_payload_hash
        from contact_messages
        where idempotency_key = ${input.idempotencyKey}
        limit 1
      `;
      if (
        !existing[0] ||
        existing[0].idempotency_payload_hash !== payloadHash
      ) {
        throw new ContactIdempotencyConflictError();
      }
      return { id: existing[0].id, replayed: true };
    }

    const ownerMail = contactOwnerMail(input);
    await queueTransactionalMail(sql, {
      dedupeKey: `contact:${id}:owner`,
      kind: "contact_owner",
      to: ownerAddress,
      replyTo: input.email,
      contactMessageId: id,
      ...ownerMail,
    });
    const customerMail = contactCustomerReceiptMail(input);
    await queueTransactionalMail(sql, {
      dedupeKey: `contact:${id}:customer`,
      kind: "contact_customer",
      to: input.email,
      replyTo: ownerAddress,
      contactMessageId: id,
      ...customerMail,
    });
    return { id, replayed: false };
  });
}

export async function listContactMessageRecords(
  input: ContactListInput,
): Promise<{
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
