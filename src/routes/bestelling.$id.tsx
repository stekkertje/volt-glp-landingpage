import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, Copy, ReceiptText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { OrderDetails, OrderStatusBadge } from "@/components/order-details";
import { SiteShell } from "@/components/site-shell";
import { Button } from "@/components/ui/button";
import { consumeOrderRecoveryCode } from "@/lib/order-recovery-memory";
import { getOrderForViewer } from "@/lib/server/orders";

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
      { title: "Bestelling | VOLT" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function OrderConfirmationPage() {
  const order = Route.useLoaderData();
  const orderId = order?.id;
  const [stagedRecovery, setStagedRecovery] = useState<{
    orderId: string;
    code: string;
  } | null>(null);
  const [copyState, setCopyState] = useState<
    "idle" | "copying" | "copied" | "error"
  >("idle");
  const lastConsumedOrderId = useRef<string | null>(null);
  const copyRequestSequence = useRef(0);
  const recoveryCode =
    stagedRecovery && stagedRecovery.orderId === orderId
      ? stagedRecovery.code
      : null;

  useEffect(() => {
    copyRequestSequence.current += 1;
    setCopyState("idle");
    if (!orderId) {
      lastConsumedOrderId.current = null;
      setStagedRecovery(null);
      return;
    }
    if (lastConsumedOrderId.current === orderId) return;
    lastConsumedOrderId.current = orderId;
    const code = consumeOrderRecoveryCode(orderId);
    setStagedRecovery(code ? { orderId, code } : null);
  }, [orderId]);

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
            Deze bestelling bestaat niet of je hebt geen toegang. Gebruik je
            herstelcode via je accountpagina.
          </p>
          <Button className="mt-6" asChild>
            <Link to="/account">Naar account</Link>
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

            {recoveryCode && (
              <section className="mt-5 rounded-xl border border-primary/25 bg-primary/5 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
                  Eenmalig zichtbaar
                </p>
                <h2 className="mt-1 text-lg font-extrabold tracking-tight">
                  Bewaar je herstelcode
                </h2>
                <p className="mt-1 text-sm text-muted">
                  Hiermee kun je deze bestelling 72 uur lang als gast
                  terugvinden.
                </p>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <code className="min-w-0 flex-1 break-all rounded-lg border border-border bg-surface px-3 py-2.5 text-sm font-bold tracking-wide text-fg">
                    {recoveryCode}
                  </code>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={copyState === "copying"}
                    aria-busy={copyState === "copying"}
                    onClick={async () => {
                      if (copyState === "copying") return;
                      const requestSequence = ++copyRequestSequence.current;
                      setCopyState("copying");
                      try {
                        await navigator.clipboard.writeText(recoveryCode);
                        if (requestSequence === copyRequestSequence.current) {
                          setCopyState("copied");
                        }
                      } catch {
                        if (requestSequence === copyRequestSequence.current) {
                          setCopyState("error");
                        }
                      }
                    }}
                  >
                    <Copy className="size-4" aria-hidden />
                    {copyState === "copying"
                      ? "Kopiëren…"
                      : copyState === "copied"
                        ? "Gekopieerd"
                        : copyState === "error"
                          ? "Opnieuw kopiëren"
                          : "Kopieer"}
                  </Button>
                </div>
                {copyState === "copied" && (
                  <p role="status" aria-live="polite" className="sr-only">
                    Herstelcode gekopieerd.
                  </p>
                )}
                {copyState === "error" && (
                  <p role="alert" className="mt-3 text-sm text-danger">
                    Kopiëren is niet gelukt. Selecteer de code en kopieer deze
                    handmatig.
                  </p>
                )}
              </section>
            )}

            <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">{createdAt}</p>
                <p className="mt-1 text-xs text-muted">
                  Status van je bestelling
                </p>
              </div>
              <OrderStatusBadge status={order.status} />
            </div>

            <div className="mt-5">
              <OrderDetails order={order} />
            </div>

            <div className="mt-8 flex flex-col gap-2 sm:flex-row">
              <Button asChild>
                <Link to="/">Verder winkelen</Link>
              </Button>
              <Button variant="secondary" asChild>
                <Link to="/account">Bestellingen bekijken</Link>
              </Button>
            </div>
          </div>
        </div>
      </main>
    </SiteShell>
  );
}
