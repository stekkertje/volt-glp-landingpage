import { randomUUID } from "node:crypto";
import { getSql, type Sql } from "@/lib/db";
import { retainedMailBodyMatches } from "@/lib/server/mail/body-retention.server";

const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export type TransactionalMailDraft = {
  dedupeKey: string;
  kind: string;
  to: string;
  replyTo?: string | null;
  subject: string;
  textBody: string;
  htmlBody: string;
  contactMessageId?: string | null;
  orderId?: string | null;
  orderEventId?: string | null;
  userId?: string | null;
};

export type QueuedMail = { id: string; queued: boolean };

type ExistingMailRow = {
  id: string;
  kind: string;
  recipient: string;
  reply_to: string | null;
  subject: string;
  text_body: string;
  html_body: string;
  contact_message_id: string | null;
  order_id: string | null;
  order_event_id: string | null;
  user_id: string | null;
};

function optionalReference(
  value: string | null | undefined,
  field: string,
): string | null {
  if (value == null) return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > 200 || /[\r\n]/.test(normalized)) {
    throw new Error(`${field} is ongeldig.`);
  }
  return normalized;
}

function normalizedEmail(raw: string, field: string): string {
  const value = raw.trim().toLowerCase();
  if (
    value.length > 254 ||
    value.includes("\r") ||
    value.includes("\n") ||
    !EMAIL_PATTERN.test(value)
  ) {
    throw new Error(`${field} bevat geen geldig e-mailadres.`);
  }
  return value;
}

function validateDraft(
  draft: TransactionalMailDraft,
): Required<TransactionalMailDraft> {
  const dedupeKey = draft.dedupeKey.trim();
  const kind = draft.kind.trim();
  const subject = draft.subject.trim();
  if (!/^[A-Za-z0-9:_-]{1,240}$/.test(dedupeKey)) {
    throw new Error("De mail-dedupekey is ongeldig.");
  }
  if (!/^[a-z][a-z0-9_]{0,79}$/.test(kind)) {
    throw new Error("Het mailtype is ongeldig.");
  }
  if (!subject || subject.length > 200 || /[\r\n]/.test(subject)) {
    throw new Error("Het mailonderwerp is ongeldig.");
  }
  if (!draft.textBody.trim() || draft.textBody.length > 100_000) {
    throw new Error("De platte mailtekst is ongeldig.");
  }
  if (!draft.htmlBody.trim() || draft.htmlBody.length > 200_000) {
    throw new Error("De HTML-mailtekst is ongeldig.");
  }
  return {
    dedupeKey,
    kind,
    to: normalizedEmail(draft.to, "Ontvanger"),
    replyTo: draft.replyTo ? normalizedEmail(draft.replyTo, "Reply-to") : null,
    subject,
    textBody: draft.textBody,
    htmlBody: draft.htmlBody,
    contactMessageId: optionalReference(
      draft.contactMessageId,
      "Contactberichtreferentie",
    ),
    orderId: optionalReference(draft.orderId, "Bestelreferentie"),
    orderEventId: optionalReference(
      draft.orderEventId,
      "Gebeurtenisreferentie",
    ),
    userId: optionalReference(draft.userId, "Gebruikersreferentie"),
  };
}

/** Queue mail on an existing transaction so domain data and mail intent commit together. */
export async function queueTransactionalMail(
  sql: Sql,
  rawDraft: TransactionalMailDraft,
): Promise<QueuedMail> {
  const draft = validateDraft(rawDraft);
  const id = randomUUID();
  const inserted = await sql<{ id: string }>`
    insert into transactional_mail_outbox (
      id, dedupe_key, kind, recipient, reply_to, subject, text_body, html_body,
      contact_message_id, order_id, order_event_id, user_id,
      status, attempt_count, next_attempt_at, created_at, updated_at
    ) values (
      ${id}, ${draft.dedupeKey}, ${draft.kind}, ${draft.to}, ${draft.replyTo},
      ${draft.subject}, ${draft.textBody}, ${draft.htmlBody},
      ${draft.contactMessageId}, ${draft.orderId}, ${draft.orderEventId}, ${draft.userId},
      'pending', 0,
      now(), now(), now()
    )
    on conflict (dedupe_key) do nothing
    returning id
  `;
  if (inserted[0]) return { id: inserted[0].id, queued: true };

  const existing = await sql<ExistingMailRow>`
    select id, kind, recipient, reply_to, subject, text_body, html_body,
           contact_message_id, order_id, order_event_id, user_id
    from transactional_mail_outbox
    where dedupe_key = ${draft.dedupeKey}
  `;
  const row = existing[0];
  if (
    !row ||
    row.kind !== draft.kind ||
    row.recipient !== draft.to ||
    row.reply_to !== draft.replyTo ||
    row.subject !== draft.subject ||
    !retainedMailBodyMatches(row.text_body, draft.textBody) ||
    !retainedMailBodyMatches(row.html_body, draft.htmlBody) ||
    row.contact_message_id !== draft.contactMessageId ||
    row.order_id !== draft.orderId ||
    row.order_event_id !== draft.orderEventId ||
    row.user_id !== draft.userId
  ) {
    throw new Error("Conflicterende idempotente mailaanvraag.");
  }
  return { id: row.id, queued: false };
}

/** Queue standalone mail when the caller has no surrounding domain transaction. */
export async function enqueueTransactionalMail(
  draft: TransactionalMailDraft,
): Promise<QueuedMail> {
  return queueTransactionalMail(await getSql(), draft);
}
