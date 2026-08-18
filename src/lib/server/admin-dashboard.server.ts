import { getSql } from "@/lib/db";

export type AdminSummary = {
  pendingOrders: number;
  processingOrders: number;
  openContacts: number;
};

export async function getAdminSummaryRecord(): Promise<AdminSummary> {
  const sql = await getSql();
  const rows = await sql<{
    pending_orders: number;
    processing_orders: number;
    open_contacts: number;
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
      ) as open_contacts
  `;
  const row = rows[0];
  return {
    pendingOrders: row?.pending_orders ?? 0,
    processingOrders: row?.processing_orders ?? 0,
    openContacts: row?.open_contacts ?? 0,
  };
}
