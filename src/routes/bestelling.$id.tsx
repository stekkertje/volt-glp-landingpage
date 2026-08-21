import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, ReceiptText } from "lucide-react";
import { useEffect, useState } from "react";
import { OrderDetails, OrderStatusBadge } from "@/components/order-details";
import { SiteShell } from "@/components/site-shell";
import { Button } from "@/components/ui/button";
import { authEnabled } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getOrderForViewer } from "@/lib/server/orders";

type ViewerOrder = Awaited<ReturnType<typeof getOrderForViewer>>;
type ClientOrderLookup = {
  orderId: string;
  viewerKey: string;
  order: ViewerOrder | null;
  pending: boolean;
};

export const Route = createFileRoute("/bestelling/$id")({
  loader: async ({ params }) => {
    try {
      return await getOrderForViewer({ data: { id: params.id } });
    } catch {
      return null;
    }
  },
  component: OrderConfirmationPage,
  head: () => ({
    meta: [
      { title: "Bestelling | Afslank-injecties.nl" },
      { name: "robots", content: "noindex, nofollow, noarchive" },
    ],
  }),
});

function OrderConfirmationPage() {
  const loaderOrder = Route.useLoaderData();
  const { id: requestedOrderId } = Route.useParams();
  const { user, isPending: authPending } = useCurrentUserState();
  const viewerKey = authPending ? null : (user?.id ?? "guest");
  const [clientLookup, setClientLookup] = useState<ClientOrderLookup | null>(
    null,
  );
  const matchingClientLookup =
    clientLookup?.orderId === requestedOrderId &&
    clientLookup.viewerKey === viewerKey
      ? clientLookup
      : null;
  const order = loaderOrder ?? matchingClientLookup?.order ?? null;

  useEffect(() => {
    if (loaderOrder || !viewerKey) return;
    let active = true;
    setClientLookup({
      orderId: requestedOrderId,
      viewerKey,
      order: null,
      pending: true,
    });
    void getOrderForViewer({ data: { id: requestedOrderId } })
      .then((nextOrder) => {
        if (active) {
          setClientLookup({
            orderId: requestedOrderId,
            viewerKey,
            order: nextOrder,
            pending: false,
          });
        }
      })
      .catch(() => {
        if (active) {
          setClientLookup({
            orderId: requestedOrderId,
            viewerKey,
            order: null,
            pending: false,
          });
        }
      });
    return () => {
      active = false;
    };
  }, [loaderOrder, requestedOrderId, viewerKey]);

  if (!order && (!matchingClientLookup || matchingClientLookup.pending)) {
    return (
      <SiteShell>
        <main className="container-max section-pad py-16 text-center md:py-24">
          <p className="text-sm text-muted" role="status" aria-live="polite">
            Bestelling laden…
          </p>
        </main>
      </SiteShell>
    );
  }

  if (!order) {
    return (
      <SiteShell>
        <main className="container-max section-pad py-16 text-center md:py-24">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-bg-elevated text-muted">
            <ReceiptText className="size-5" aria-hidden />
          </span>
          <h1 className="mt-5 text-2xl font-extrabold tracking-tight">
            Bestelling niet beschikbaar
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            Deze bestelling bestaat niet of je hebt geen toegang.
            {authEnabled
              ? " Log in met het account waaraan de bestelling is gekoppeld."
              : " Neem contact met ons op als je hulp nodig hebt."}
          </p>
          <Button className="mt-6" asChild>
            <Link to="/account">
              {authEnabled ? "Naar account" : "Hulp bij bestelling"}
            </Link>
          </Button>
        </main>
      </SiteShell>
    );
  }

  const createdAt = new Intl.DateTimeFormat("nl-NL", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(order.createdAt));

  return (
    <SiteShell>
      <main className="border-b border-border bg-bg-elevated">
        <div className="container-max section-pad py-10 md:py-16">
          <div className="mx-auto max-w-3xl">
            <div className="rounded-xl border border-success/25 bg-success/5 p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-success" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-success">
                    Bestelling ontvangen
                  </p>
                  <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">
                    {order.orderNumber}
                  </h1>
                  <p className="mt-2 text-sm text-muted">
                    We sturen handmatig een betaalverzoek naar {order.email}. Er
                    is nog geen online betaling gedaan.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-8 grid gap-4 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted">Besteld op</p>
                <p className="text-sm font-semibold">{createdAt}</p>
              </div>
              <div>
                <p className="text-xs text-muted">Status van je bestelling</p>
                <div className="mt-1">
                  <OrderStatusBadge status={order.status} />
                </div>
              </div>
            </div>

            <div className="mt-5">
              <OrderDetails order={order} />
            </div>

            <div className="mt-8 flex flex-col gap-2 sm:flex-row">
              <Button asChild>
                <Link to="/">Verder winkelen</Link>
              </Button>
              <Button variant="secondary" asChild>
                <Link to="/account">
                  {authEnabled
                    ? "Bestellingen bekijken"
                    : "Hulp bij bestelling"}
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </main>
    </SiteShell>
  );
}
