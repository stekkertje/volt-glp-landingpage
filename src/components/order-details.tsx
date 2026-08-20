import { formatEuro } from "@/lib/utils";
import { orderLineSummary } from "@/lib/product";
import { ORDER_STATUS_LABELS, type OrderStatus } from "@/lib/order-status";
import type { PublicOrder } from "@/lib/server/orders.server";
import type { TrackingStatus } from "@/lib/server/integrations/myparcel.server";
import { ExternalLink } from "lucide-react";

const trackingStatusLabels: Record<TrackingStatus, string> = {
  concept: "Zending wordt voorbereid",
  registered: "Zending aangemeld",
  handed_over: "Overgedragen aan vervoerder",
  in_transit: "Onderweg",
  delivered: "Bezorgd",
  exception: "Vertraging of bijzonderheid",
  returned: "Retour onderweg",
  unknown: "Status wordt bijgewerkt",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className="inline-flex rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
      {ORDER_STATUS_LABELS[status]}
    </span>
  );
}

export function OrderDetails({ order }: { order: PublicOrder }) {
  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border bg-surface p-5 shadow-sm">
        <h2 className="text-lg font-extrabold tracking-tight">Je bestelling</h2>
        <div className="mt-4 divide-y divide-border">
          {order.lines.map((line) => (
            <div
              key={line.id}
              className="grid grid-cols-[1fr_auto] gap-3 py-3 text-sm"
            >
              <div>
                <p className="font-semibold text-fg">{line.name}</p>
                <p className="text-xs text-muted">
                  {orderLineSummary(line.slug, line.optionLabel, line.qty)}
                </p>
              </div>
              <p className="font-semibold tabular-nums">
                {formatEuro(line.lineTotalCents)}
              </p>
            </div>
          ))}
        </div>
        <dl className="space-y-2 border-t border-border pt-4 text-sm">
          <AmountRow label="Subtotaal" value={order.subtotalCents} />
          {order.stackDiscountCents > 0 && (
            <AmountRow
              label="Stapelkorting"
              value={-order.stackDiscountCents}
              discount
            />
          )}
          {order.codeDiscountCents > 0 && (
            <AmountRow
              label={`Kortingscode${order.discountCode ? ` ${order.discountCode}` : ""}`}
              value={-order.codeDiscountCents}
              discount
            />
          )}
          <AmountRow
            label="Verzending"
            value={order.shippingCents}
            free={order.shippingCents === 0}
          />
          <div className="flex items-center justify-between border-t border-border pt-3 text-base font-extrabold">
            <dt>Totaal</dt>
            <dd className="tabular-nums text-primary">
              {formatEuro(order.totalCents)}
            </dd>
          </div>
        </dl>
      </section>

      {order.tracking && (
        <section className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          <h2 className="text-sm font-bold tracking-tight">
            Verzending en tracking
          </h2>
          <p className="mt-2 text-sm text-muted">
            {trackingStatusLabels[order.tracking.trackingStatus]}
          </p>
          {order.tracking.barcode && (
            <p className="mt-1 text-xs text-muted">
              Track &amp; trace:{" "}
              <span className="font-semibold text-fg">
                {order.tracking.barcode}
              </span>
            </p>
          )}
          {order.tracking.trackingUrl && (
            <a
              href={order.tracking.trackingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
            >
              Volg je pakket
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          )}
        </section>
      )}

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface p-4">
          <h2 className="text-sm font-bold tracking-tight">Bezorgadres</h2>
          <address className="mt-2 text-sm not-italic leading-relaxed text-muted">
            {order.name}
            <br />
            {order.street} {order.houseNumber}
            <br />
            {order.postcode} {order.city}
            <br />
            {order.country === "NL" ? "Nederland" : "België"}
          </address>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <h2 className="text-sm font-bold tracking-tight">Contact</h2>
          <p className="mt-2 break-words text-sm text-muted">{order.email}</p>
          {order.phone && (
            <p className="mt-1 text-sm text-muted">{order.phone}</p>
          )}
          {order.note && (
            <>
              <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-dim">
                Opmerking
              </h3>
              <p className="mt-1 whitespace-pre-wrap text-sm text-muted">
                {order.note}
              </p>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function AmountRow({
  label,
  value,
  discount = false,
  free = false,
}: {
  label: string;
  value: number;
  discount?: boolean;
  free?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between ${discount ? "text-success" : ""}`}
    >
      <dt>{label}</dt>
      <dd className="tabular-nums">
        {free
          ? "Gratis"
          : `${value < 0 ? "−" : ""}${formatEuro(Math.abs(value))}`}
      </dd>
    </div>
  );
}
