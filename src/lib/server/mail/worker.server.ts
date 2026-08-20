import { randomUUID } from "node:crypto";
import { getSql, type Sql, withSqlTransaction } from "@/lib/db";
import { resolveMailConfiguration } from "@/lib/server/mail/config.server";
import { scrubbedMailBodies } from "@/lib/server/mail/body-retention.server";
import {
  deliverTransactionalMail,
  type MailDelivery,
} from "@/lib/server/mail/transport.server";

const MAX_ATTEMPTS = 6;
const STALE_LOCK_MINUTES = 10;

type OutboxRow = MailDelivery & {
  attemptCount: number;
};

type RawOutboxRow = {
  id: string;
  recipient: string;
  reply_to: string | null;
  subject: string;
  text_body: string;
  html_body: string;
  attempt_count: number;
};

export type MailOutboxResult = {
  configured: boolean;
  delivered: number;
  deferred: number;
  failed: number;
};

type Deliver = typeof deliverTransactionalMail;

type SmtpFailure = {
  code?: unknown;
  command?: unknown;
  syscall?: unknown;
};

function safeFailureCode(error: unknown): string {
  if (!error || typeof error !== "object") return "smtp_unknown";
  const record = error as {
    code?: unknown;
    responseCode?: unknown;
    command?: unknown;
  };
  const code =
    typeof record.code === "string" && /^[A-Z0-9_]{1,40}$/i.test(record.code)
      ? record.code.toLowerCase()
      : "error";
  const response =
    typeof record.responseCode === "number" &&
    Number.isInteger(record.responseCode)
      ? `_${record.responseCode}`
      : "";
  const command =
    typeof record.command === "string" &&
    /^[A-Z0-9_ -]{1,30}$/i.test(record.command)
      ? `_${record.command.toLowerCase().replaceAll(" ", "_")}`
      : "";
  return `smtp_${code}${response}${command}`.slice(0, 100);
}

/**
 * Only retry failures that Nodemailer identifies as occurring before message
 * delivery could have started. Any DATA-stage or ambiguous socket failure may
 * have happened after SMTP accepted the message and must never be resent
 * automatically.
 */
function isProvablyPreDeliveryFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as SmtpFailure;
  const code =
    typeof record.code === "string" ? record.code.trim().toUpperCase() : "";
  const command =
    typeof record.command === "string"
      ? record.command.trim().toUpperCase()
      : "";
  const syscall =
    typeof record.syscall === "string"
      ? record.syscall.trim().toLowerCase()
      : "";

  if (command === "DATA" || command.startsWith("DATA ")) return false;
  if (["EAUTH", "EDNS", "ETLS", "ECONNECTION"].includes(code)) return true;
  if (
    command === "AUTH" ||
    command.startsWith("AUTH ") ||
    command === "EHLO" ||
    command === "HELO" ||
    command === "MAIL FROM" ||
    command === "RCPT TO"
  ) {
    return true;
  }
  return command === "CONN" && ["connect", "getaddrinfo"].includes(syscall);
}

function uncertainFailureCode(error: unknown): string {
  if (error && typeof error === "object") {
    const command = (error as SmtpFailure).command;
    if (
      typeof command === "string" &&
      command.trim().toUpperCase().startsWith("DATA")
    ) {
      return "delivery_uncertain_smtp_data";
    }
  }
  return "delivery_uncertain_smtp_transport";
}

function retryDelaySeconds(attempt: number): number {
  return [60, 300, 900, 3_600, 14_400][Math.max(0, attempt - 1)] ?? 14_400;
}

/**
 * A stale `sending` claim may have crashed after SMTP accepted the message but
 * before `markSent` committed. Never resend that row automatically: doing so
 * can duplicate a customer-facing message. Keep it terminal and visible for
 * manual mailbox/provider verification.
 */
async function recoverStaleClaims(): Promise<number> {
  return withSqlTransaction(async (sql) => {
    const rows = await sql.query<
      Pick<RawOutboxRow, "id" | "text_body" | "html_body">
    >(
      `select id, text_body, html_body
       from transactional_mail_outbox
       where status = 'sending'
         and locked_at < now() - ($1 * interval '1 minute')
       for update skip locked`,
      [STALE_LOCK_MINUTES],
    );
    let recovered = 0;
    for (const row of rows) {
      const retained = scrubbedMailBodies({
        textBody: row.text_body,
        htmlBody: row.html_body,
      });
      const updated = await sql.query<{ id: string }>(
        `update transactional_mail_outbox
         set status = 'failed',
             next_attempt_at = null,
             locked_at = null,
             locked_by = null,
             last_error = 'delivery_uncertain_after_worker_timeout',
             text_body = $1,
             html_body = $2,
             updated_at = now()
         where id = $3 and status = 'sending'
         returning id`,
        [retained.textBody, retained.htmlBody, row.id],
      );
      recovered += updated.length;
    }
    return recovered;
  });
}

async function claimNextMail(
  sql: Sql,
  workerId: string,
): Promise<OutboxRow | null> {
  const rows = await sql.query<RawOutboxRow>(
    `update transactional_mail_outbox
     set status = 'sending',
         attempt_count = attempt_count + 1,
         locked_at = now(),
         locked_by = $1,
         last_error = null,
         updated_at = now()
     where id = (
       select id
       from transactional_mail_outbox
       where status = 'pending'
         and attempt_count < $2
         and next_attempt_at <= now()
       order by next_attempt_at asc, created_at asc
       for update skip locked
       limit 1
     )
     returning id, recipient, reply_to, subject, text_body, html_body, attempt_count`,
    [workerId, MAX_ATTEMPTS],
  );
  const row = rows[0];
  return row
    ? {
        id: row.id,
        to: row.recipient,
        replyTo: row.reply_to,
        subject: row.subject,
        textBody: row.text_body,
        htmlBody: row.html_body,
        attemptCount: row.attempt_count,
      }
    : null;
}

async function markSent(
  sql: Sql,
  row: OutboxRow,
  workerId: string,
  providerMessageId: string | null,
): Promise<void> {
  const retained = scrubbedMailBodies({
    textBody: row.textBody,
    htmlBody: row.htmlBody,
  });
  const updated = await sql.query<{ id: string }>(
    `update transactional_mail_outbox
     set status = 'sent', sent_at = now(), next_attempt_at = null,
         locked_at = null, locked_by = null, last_error = null,
         provider_message_id = $1, text_body = $2, html_body = $3,
         updated_at = now()
     where id = $4 and status = 'sending' and locked_by = $5
     returning id`,
    [providerMessageId, retained.textBody, retained.htmlBody, row.id, workerId],
  );
  if (!updated[0]) {
    throw new Error(
      "De geaccepteerde e-mailstatus kon niet worden vastgelegd.",
    );
  }
}

async function markFailure(
  sql: Sql,
  row: OutboxRow,
  workerId: string,
  error: unknown,
): Promise<"deferred" | "failed"> {
  const terminal = row.attemptCount >= MAX_ATTEMPTS;
  const delay = retryDelaySeconds(row.attemptCount);
  if (terminal) {
    const retained = scrubbedMailBodies({
      textBody: row.textBody,
      htmlBody: row.htmlBody,
    });
    await sql.query(
      `update transactional_mail_outbox
       set status = 'failed', next_attempt_at = null,
           locked_at = null, locked_by = null, last_error = $1,
           text_body = $2, html_body = $3, updated_at = now()
       where id = $4 and status = 'sending' and locked_by = $5`,
      [
        safeFailureCode(error),
        retained.textBody,
        retained.htmlBody,
        row.id,
        workerId,
      ],
    );
    return "failed";
  }
  await sql.query(
    `update transactional_mail_outbox
     set status = 'pending',
         next_attempt_at = now() + ($1 * interval '1 second'),
         locked_at = null, locked_by = null, last_error = $2, updated_at = now()
     where id = $3 and status = 'sending' and locked_by = $4`,
    [delay, safeFailureCode(error), row.id, workerId],
  );
  return "deferred";
}

async function markDeliveryUncertain(
  sql: Sql,
  row: OutboxRow,
  workerId: string,
  error: unknown,
): Promise<void> {
  const retained = scrubbedMailBodies({
    textBody: row.textBody,
    htmlBody: row.htmlBody,
  });
  await sql.query(
    `update transactional_mail_outbox
     set status = 'failed', next_attempt_at = null,
         locked_at = null, locked_by = null, last_error = $1,
         text_body = $2, html_body = $3, updated_at = now()
     where id = $4 and status = 'sending' and locked_by = $5`,
    [
      uncertainFailureCode(error),
      retained.textBody,
      retained.htmlBody,
      row.id,
      workerId,
    ],
  );
}

export async function processMailOutbox(
  options: {
    limit?: number;
    deliver?: Deliver;
    environment?: Record<string, string | undefined>;
  } = {},
): Promise<MailOutboxResult> {
  const environment = options.environment ?? process.env;
  if (!resolveMailConfiguration(environment)) {
    return { configured: false, delivered: 0, deferred: 0, failed: 0 };
  }

  const sql = await getSql();
  const workerId = randomUUID();
  const limit = Math.min(25, Math.max(1, Math.trunc(options.limit ?? 10)));
  const deliver = options.deliver ?? deliverTransactionalMail;
  const result: MailOutboxResult = {
    configured: true,
    delivered: 0,
    deferred: 0,
    failed: 0,
  };

  result.failed += await recoverStaleClaims();
  for (let processed = 0; processed < limit; processed += 1) {
    const row = await claimNextMail(sql, workerId);
    if (!row) break;
    let delivery: { providerMessageId: string | null };
    try {
      delivery = await deliver(row, environment);
    } catch (error) {
      if (!isProvablyPreDeliveryFailure(error)) {
        await markDeliveryUncertain(sql, row, workerId, error);
        result.failed += 1;
        continue;
      }
      const outcome = await markFailure(sql, row, workerId, error);
      result[outcome] += 1;
      continue;
    }
    // SMTP has accepted the message. From this point on, never move the row
    // back to pending. If persisting `sent` fails or the process crashes, the
    // sending claim remains and stale recovery marks it delivery-uncertain.
    await markSent(sql, row, workerId, delivery.providerMessageId);
    result.delivered += 1;
  }
  return result;
}
