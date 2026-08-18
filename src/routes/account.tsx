import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Loader2, LogIn, PackageSearch } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { OrderStatusBadge } from "@/components/order-details";
import { SiteShell } from "@/components/site-shell";
import { Button } from "@/components/ui/button";
import { UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getOrderForViewer, listOwnOrders } from "@/lib/server/orders";
import { rateLimitFeedback } from "@/lib/server-error";
import { formatEuro } from "@/lib/utils";

export const Route = createFileRoute("/account")({
  component: AccountPage,
  head: () => ({
    meta: [
      { title: "Mijn bestellingen | VOLT" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

type OwnOrders = Awaited<ReturnType<typeof listOwnOrders>>;

const inputClass =
  "h-11 w-full rounded-xl border border-border bg-bg px-3.5 text-sm text-fg outline-none ring-primary/30 placeholder:text-dim focus:border-primary focus:ring-2";

function AccountPage() {
  const { user, isPending } = useCurrentUserState();

  return (
    <SiteShell>
      <main className="border-b border-border bg-bg-elevated">
        <div className="container-max section-pad py-10 md:py-16">
          <div className="mx-auto max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
              Account
            </p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight">
              Mijn bestellingen
            </h1>
            <p className="mt-2 text-sm text-muted">
              Bekijk je eigen bestellingen of zoek als gast met je herstelcode.
            </p>

            {isPending ? (
              <p className="mt-8 inline-flex items-center gap-2 text-sm text-muted">
                <Loader2 className="size-4 animate-spin" />
                Account laden…
              </p>
            ) : (
              <>
                {user && !user.isDevFallback && <SignedInOrders />}
                <GuestOrderAccess showLogin={!user} />
              </>
            )}
          </div>
        </div>
      </main>
    </SiteShell>
  );
}

function SignedInOrders() {
  const [orders, setOrders] = useState<OwnOrders | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void listOwnOrders()
      .then((result) => {
        if (active) setOrders(result);
      })
      .catch(() => {
        if (active) setError("Je bestellingen konden niet worden geladen.");
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="mt-8 space-y-5">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
        <UserButton />
        <p className="text-xs text-muted">
          Alleen bestellingen van dit account
        </p>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-danger/25 bg-danger/5 p-4 text-sm text-danger"
        >
          {error}
        </p>
      )}
      {!orders && !error && (
        <p className="text-sm text-muted">Bestellingen laden…</p>
      )}
      {orders?.length === 0 && (
        <div className="rounded-xl border border-border bg-surface p-6 text-center">
          <p className="text-sm text-muted">
            Er staan nog geen bestellingen op dit account.
          </p>
          <Button className="mt-4" asChild>
            <Link to="/" hash="producten">
              Bekijk producten
            </Link>
          </Button>
        </div>
      )}
      {orders && orders.length > 0 && (
        <div className="space-y-3">
          {orders.map((order) => (
            <Link
              key={order.id}
              to="/bestelling/$id"
              params={{ id: order.id }}
              className="block rounded-xl border border-border bg-surface p-4 transition hover:border-primary/35"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-extrabold tracking-tight">
                    {order.orderNumber}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {new Intl.DateTimeFormat("nl-NL", {
                      dateStyle: "medium",
                    }).format(new Date(order.createdAt))}
                  </p>
                </div>
                <OrderStatusBadge status={order.status} />
              </div>
              <p className="mt-3 text-sm font-bold tabular-nums text-primary">
                {formatEuro(order.totalCents)}
              </p>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function GuestOrderAccess({ showLogin }: { showLogin: boolean }) {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const fields = new FormData(event.currentTarget);
    try {
      const order = await getOrderForViewer({
        data: {
          orderNumber: String(fields.get("orderNumber") ?? ""),
          accessCode: String(fields.get("accessCode") ?? ""),
        },
      });
      await navigate({ to: "/bestelling/$id", params: { id: order.id } });
    } catch (error) {
      setError(
        rateLimitFeedback(error) ??
          "Bestelling niet gevonden of herstelcode onjuist.",
      );
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className={showLogin ? "mt-8 grid gap-5 md:grid-cols-[1fr_auto]" : "mt-8"}
    >
      <form
        onSubmit={onSubmit}
        className="rounded-xl border border-border bg-surface p-5 shadow-sm sm:p-6"
      >
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <PackageSearch className="size-5" />
          </span>
          <div>
            <h2 className="text-lg font-extrabold tracking-tight">
              Bestelling als gast
            </h2>
            <p className="mt-1 text-sm text-muted">
              Gebruik het VOLT-nummer en de herstelcode die na bestellen één
              keer is getoond.
            </p>
          </div>
        </div>
        {error && (
          <p
            ref={errorRef}
            tabIndex={-1}
            role="alert"
            className="mt-4 rounded-lg border border-danger/25 bg-danger/5 p-3 text-sm text-danger outline-none"
          >
            {error}
          </p>
        )}
        <div className="mt-5 grid gap-4">
          <label className="space-y-1.5">
            <span className="text-xs font-semibold">Bestelnummer</span>
            <input
              name="orderNumber"
              required
              autoCapitalize="characters"
              placeholder="VOLT-XXXXXXXX"
              className={inputClass}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold">Herstelcode</span>
            <input
              name="accessCode"
              required
              autoCapitalize="characters"
              autoComplete="off"
              className={inputClass}
            />
          </label>
        </div>
        <Button type="submit" className="mt-5 w-full" disabled={submitting}>
          {submitting ? "Bestelling zoeken…" : "Bestelling bekijken"}
        </Button>
      </form>

      {showLogin && (
        <div className="flex items-center justify-center text-center md:w-52">
          <div>
            <LogIn className="mx-auto size-5 text-primary" />
            <p className="mt-2 text-sm font-semibold">Heb je een account?</p>
            <Button className="mt-3" variant="secondary" asChild>
              <Link to="/login" search={{ redirect: "/account" }}>
                Inloggen
              </Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
