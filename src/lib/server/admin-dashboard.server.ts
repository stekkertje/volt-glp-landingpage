import { getSql } from "@/lib/db";

export type AdminSummary = {
  pendingOrders: number;
  processingOrders: number;
  openContacts: number;
  failedMails: number;
  uncertainMails: number;
  mailFailures: AdminMailFailure[];
};

export type AdminMailFailure = {
  id: string;
  kind: string;
  recipient: string;
  reference: string | null;
  failedAt: string;
  deliveryUncertain: boolean;
};

type MailFailureRow = {
  id: string;
  kind: string;
  recipient: string;
  order_number: string | null;
  contact_message_id: string | null;
  updated_at: Date | string;
  delivery_uncertain: boolean;
};

function maskEmail(raw: string): string {
  const separator = raw.lastIndexOf("@");
  if (separator <= 0 || separator === raw.length - 1) return "***";
  const local = raw.slice(0, separator);
  const domain = raw.slice(separator + 1);
  const dot = domain.lastIndexOf(".");
  const domainName = dot > 0 ? domain.slice(0, dot) : domain;
  const suffix = dot > 0 ? domain.slice(dot) : "";
  return `${local.slice(0, 1)}***@${domainName.slice(0, 1)}***${suffix}`;
}

function iso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

export async function getAdminSummaryRecord(): Promise<AdminSummary> {
  const sql = await getSql();
  const rows = await sql<{
    pending_orders: number;
    processing_orders: number;
    open_contacts: number;
    failed_mails: number;
    uncertain_mails: number;
  }>`
    select
      (select count(*)::int from orders where status = 'pending') as pending_orders,
      (
        select count(*)::int
        from orders
        where status in ('paid', 'packed')
      ) as processing_orders,
      (
        select count(*)::int
        from contact_messages
        where handled = false
      ) as open_contacts,
      (
        select count(*)::int
        from transactional_mail_outbox
        where status = 'failed'
      ) as failed_mails,
      (
        select count(*)::int
        from transactional_mail_outbox
        where status = 'failed'
          and last_error like 'delivery_uncertain_%'
      ) as uncertain_mails
  `;
  const mailFailureRows = await sql<MailFailureRow>`
    select mail.id, mail.kind, mail.recipient, orders.order_number,
           mail.contact_message_id, mail.updated_at,
           (mail.last_error like 'delivery_uncertain_%') as delivery_uncertain
    from transactional_mail_outbox mail
    left join orders on orders.id = mail.order_id
    where mail.status = 'failed'
    order by mail.updated_at desc, mail.id desc
    limit 10
  `;
  const row = rows[0];
  return {
    pendingOrders: row?.pending_orders ?? 0,
    processingOrders: row?.processing_orders ?? 0,
    openContacts: row?.open_contacts ?? 0,
    failedMails: row?.failed_mails ?? 0,
    uncertainMails: row?.uncertain_mails ?? 0,
    mailFailures: mailFailureRows.map((mail) => ({
      id: mail.id,
      kind: mail.kind,
      recipient: maskEmail(mail.recipient),
      reference: mail.order_number
        ? `Bestelling ${mail.order_number}`
        : mail.contact_message_id
          ? `Contactbericht ${mail.contact_message_id.slice(-8)}`
          : null,
      failedAt: iso(mail.updated_at),
      deliveryUncertain: mail.delivery_uncertain,
    })),
  };
}
