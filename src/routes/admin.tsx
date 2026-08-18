import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  LogOut,
  Mail,
  Package,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { OrderDetails, OrderStatusBadge } from "@/components/order-details";
import { Button } from "@/components/ui/button";
import { ORDER_STATUS_LABELS, type OrderStatus } from "@/lib/order-status";
import { getAdminSessionState, loginAdmin, logoutAdmin } from "@/lib/server/admin";
import { listContactMessages, setContactHandled } from "@/lib/server/contact";
import {
  getOrderForAdmin,
  listOrders,
  updateOrderStatus,
} from "@/lib/server/orders";
import { formatEuro } from "@/lib/utils";

export const Route = createFileRoute("/admin")({
  component: AdminPage,
  head: () => ({
    meta: [
      { title: "Beheer | VOLT" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

type OrderListResult = Awaited<ReturnType<typeof listOrders>>;
type AdminOrder = Awaited<ReturnType<typeof getOrderForAdmin>>;
type ContactListResult = Awaited<ReturnType<typeof listContactMessages>>;

const inputClass =
  "h-11 w-full rounded-xl border border-border bg-bg px-3.5 text-sm text-fg outline-none ring-primary/30 placeholder:text-dim focus:border-primary focus:ring-2";

function AdminPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    void getAdminSessionState()
      .then((state) => {
        if (active) setAuthenticated(state.authenticated);
      })
      .catch(() => {
        if (active) setAuthenticated(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (authenticated === null) {
    return (
      <AdminFrame>
        <p className="inline-flex items-center gap-2 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" />
          Beheer laden…
        </p>
      </AdminFrame>
    );
  }

  if (!authenticated) {
    return (
      <AdminFrame>
        <AdminLogin onSuccess={() => setAuthenticated(true)} />
      </AdminFrame>
    );
  }

  return (
    <AdminFrame>
      <AdminDashboard onUnauthorized={() => setAuthenticated(false)} />
    </AdminFrame>
  );
}

function AdminFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-bg-elevated text-fg">
      <header className="border-b border-border bg-surface">
        <div className="container-max section-pad flex min-h-16 items-center justify-between gap-4 py-3">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-sm font-extrabold text-primary-fg">
              V
            </span>
            <span className="font-extrabold tracking-tight">
              VOLT<span className="text-primary">.</span> Beheer
            </span>
          </Link>
          <Link to="/" className="text-sm font-semibold text-muted hover:text-fg">
            Terug naar winkel
          </Link>
        </div>
      </header>
      <main className="container-max section-pad py-8 md:py-12">{children}</main>
    </div>
  );
}

function AdminLogin({ onSuccess }: { onSuccess: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const fields = new FormData(event.currentTarget);
    try {
      await loginAdmin({ data: { password: String(fields.get("password") ?? "") } });
      onSuccess();
    } catch {
      setError("Inloggen mislukt. Controleer het wachtwoord en probeer later opnieuw.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      className="mx-auto mt-8 max-w-sm rounded-xl border border-border bg-surface p-6 shadow-sm"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
        Beveiligd beheer
      </p>
      <h1 className="mt-2 text-2xl font-extrabold tracking-tight">Inloggen</h1>
      <p className="mt-2 text-sm text-muted">
        Alleen beheerders kunnen bestellingen en contactberichten bekijken.
      </p>
      {error && (
        <p role="alert" className="mt-4 rounded-lg border border-danger/25 bg-danger/5 p-3 text-sm text-danger">
          {error}
        </p>
      )}
      <label className="mt-5 block space-y-1.5">
        <span className="text-xs font-semibold">Beheerwachtwoord</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={inputClass}
        />
      </label>
      <Button type="submit" className="mt-5 w-full" disabled={submitting}>
        {submitting ? "Controleren…" : "Inloggen"}
      </Button>
    </form>
  );
}

function AdminDashboard({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [tab, setTab] = useState<"orders" | "contact">("orders");

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            Dashboard
          </p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight">Shopbeheer</h1>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            void logoutAdmin()
              .catch(() => undefined)
              .finally(onUnauthorized);
          }}
        >
          <LogOut className="size-4" />
          Uitloggen
        </Button>
      </div>

      <div className="mt-7 flex gap-2 border-b border-border">
        <button
          type="button"
          onClick={() => setTab("orders")}
          className={`border-b-2 px-3 py-3 text-sm font-semibold ${
            tab === "orders"
              ? "border-primary text-primary"
              : "border-transparent text-muted"
          }`}
        >
          <Package className="mr-2 inline size-4" />
          Bestellingen
        </button>
        <button
          type="button"
          onClick={() => setTab("contact")}
          className={`border-b-2 px-3 py-3 text-sm font-semibold ${
            tab === "contact"
              ? "border-primary text-primary"
              : "border-transparent text-muted"
          }`}
        >
          <Mail className="mr-2 inline size-4" />
          Contact
        </button>
      </div>

      {tab === "orders" ? (
        <OrdersAdmin onUnauthorized={onUnauthorized} />
      ) : (
        <ContactAdmin onUnauthorized={onUnauthorized} />
      )}
    </div>
  );
}

function OrdersAdmin({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [draftSearch, setDraftSearch] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<OrderStatus | "all">("all");
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<OrderListResult | null>(null);
  const [selected, setSelected] = useState<AdminOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await listOrders({
        data: {
          search: search || undefined,
          status,
          page,
          pageSize: 20,
        },
      });
      setResult(next);
    } catch {
      setError("Bestellingen konden niet worden geladen.");
      onUnauthorized();
    } finally {
      setLoading(false);
    }
  }, [onUnauthorized, page, search, status]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders, reload]);

  const openOrder = async (id: string) => {
    setError("");
    try {
      setSelected(await getOrderForAdmin({ data: { id } }));
    } catch {
      setError("Bestelling kon niet worden geopend.");
    }
  };

  return (
    <section className="mt-6">
      <form
        className="grid gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-[minmax(0,1fr)_12rem_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setSearch(draftSearch.trim());
        }}
      >
        <label className="relative">
          <span className="sr-only">Zoek bestellingen</span>
          <Search className="pointer-events-none absolute left-3.5 top-3.5 size-4 text-dim" />
          <input
            value={draftSearch}
            onChange={(event) => setDraftSearch(event.target.value)}
            placeholder="Nummer, naam of e-mail"
            className={`${inputClass} pl-10`}
          />
        </label>
        <label>
          <span className="sr-only">Filter op status</span>
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as OrderStatus | "all");
              setPage(1);
            }}
            className={inputClass}
          >
            <option value="all">Alle statussen</option>
            {Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" size="sm" className="h-11">
          Zoeken
        </Button>
      </form>

      {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
      {loading ? (
        <p className="mt-6 text-sm text-muted">Bestellingen laden…</p>
      ) : (
        <>
          <div className="mt-4 hidden overflow-x-auto rounded-xl border border-border bg-surface md:block">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-bg-elevated text-xs text-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">Datum</th>
                  <th className="px-4 py-3 font-semibold">Nummer</th>
                  <th className="px-4 py-3 font-semibold">Klant</th>
                  <th className="px-4 py-3 font-semibold">Totaal</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {result?.orders.map((order) => (
                  <tr
                    key={order.id}
                    className="cursor-pointer hover:bg-bg-elevated"
                    onClick={() => void openOrder(order.id)}
                  >
                    <td className="px-4 py-3 whitespace-nowrap">
                      {formatDate(order.createdAt)}
                    </td>
                    <td className="px-4 py-3 font-bold text-primary">
                      {order.orderNumber}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold">{order.name}</p>
                      <p className="text-xs text-muted">{order.email}</p>
                    </td>
                    <td className="px-4 py-3 font-semibold tabular-nums">
                      {formatEuro(order.totalCents)}
                    </td>
                    <td className="px-4 py-3">
                      <OrderStatusBadge status={order.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 space-y-3 md:hidden">
            {result?.orders.map((order) => (
              <button
                key={order.id}
                type="button"
                onClick={() => void openOrder(order.id)}
                className="w-full rounded-xl border border-border bg-surface p-4 text-left"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-extrabold text-primary">{order.orderNumber}</p>
                    <p className="mt-1 text-xs text-muted">{formatDate(order.createdAt)}</p>
                  </div>
                  <OrderStatusBadge status={order.status} />
                </div>
                <p className="mt-3 text-sm font-semibold">{order.name}</p>
                <p className="break-all text-xs text-muted">{order.email}</p>
                <p className="mt-2 text-sm font-bold">{formatEuro(order.totalCents)}</p>
              </button>
            ))}
          </div>
          {result?.orders.length === 0 && (
            <p className="mt-6 text-sm text-muted">Geen bestellingen gevonden.</p>
          )}
          {result && (
            <Pagination
              page={result.page}
              pageCount={result.pageCount}
              onPage={setPage}
            />
          )}
        </>
      )}

      {selected && (
        <OrderAdminDetail
          order={selected}
          onClose={() => setSelected(null)}
          onUpdated={(order) => {
            setSelected(order);
            setReload((value) => value + 1);
          }}
        />
      )}
    </section>
  );
}

function OrderAdminDetail({
  order,
  onClose,
  onUpdated,
}: {
  order: AdminOrder;
  onClose: () => void;
  onUpdated: (order: AdminOrder) => void;
}) {
  const [status, setStatus] = useState<OrderStatus>(order.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  return (
    <div className="mt-6 rounded-xl border border-border bg-surface p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted">Besteldetail</p>
          <h2 className="text-xl font-extrabold tracking-tight">{order.orderNumber}</h2>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Sluiten
        </Button>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="space-y-1.5">
          <span className="text-xs font-semibold">Status</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as OrderStatus)}
            className={inputClass}
          >
            {Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="button"
          disabled={saving || status === order.status}
          onClick={async () => {
            if (!window.confirm(`Status wijzigen naar ${ORDER_STATUS_LABELS[status]}?`)) {
              return;
            }
            setSaving(true);
            setError("");
            try {
              onUpdated(
                await updateOrderStatus({
                  data: { id: order.id, status },
                }),
              );
            } catch {
              setError("Status wijzigen is niet gelukt.");
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Opslaan…" : "Status opslaan"}
        </Button>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      <div className="mt-6">
        <OrderDetails order={order} />
      </div>
    </div>
  );
}

function ContactAdmin({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [handled, setHandled] = useState(false);
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<ContactListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void listContactMessages({ data: { handled, page, pageSize: 20 } })
      .then((next) => {
        if (active) setResult(next);
      })
      .catch(() => {
        if (!active) return;
        setError("Contactberichten konden niet worden geladen.");
        onUnauthorized();
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [handled, onUnauthorized, page, reload]);

  return (
    <section className="mt-6">
      <div className="inline-flex rounded-full border border-border bg-surface p-1">
        <button
          type="button"
          onClick={() => {
            setHandled(false);
            setPage(1);
          }}
          className={`rounded-full px-4 py-2 text-sm font-semibold ${
            !handled ? "bg-primary text-primary-fg" : "text-muted"
          }`}
        >
          Open
        </button>
        <button
          type="button"
          onClick={() => {
            setHandled(true);
            setPage(1);
          }}
          className={`rounded-full px-4 py-2 text-sm font-semibold ${
            handled ? "bg-primary text-primary-fg" : "text-muted"
          }`}
        >
          Afgehandeld
        </button>
      </div>
      {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
      {loading ? (
        <p className="mt-6 text-sm text-muted">Contactberichten laden…</p>
      ) : (
        <div className="mt-4 space-y-3">
          {result?.messages.map((message) => (
            <article
              key={message.id}
              className="rounded-xl border border-border bg-surface p-4 sm:p-5"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="font-bold">{message.name}</p>
                  <p className="break-all text-xs text-muted">{message.email}</p>
                  <p className="mt-1 text-xs text-dim">{formatDate(message.createdAt)}</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={message.handled ? "secondary" : "primary"}
                  onClick={async () => {
                    try {
                      await setContactHandled({
                        data: { id: message.id, handled: !message.handled },
                      });
                      setReload((value) => value + 1);
                    } catch {
                      setError("Contactstatus wijzigen is niet gelukt.");
                    }
                  }}
                >
                  {message.handled ? (
                    "Markeer als open"
                  ) : (
                    <>
                      <Check className="size-4" />
                      Markeer afgehandeld
                    </>
                  )}
                </Button>
              </div>
              <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-fg">
                {message.message}
              </p>
            </article>
          ))}
          {result?.messages.length === 0 && (
            <p className="text-sm text-muted">Geen contactberichten in deze lijst.</p>
          )}
          {result && (
            <Pagination
              page={result.page}
              pageCount={result.pageCount}
              onPage={setPage}
            />
          )}
        </div>
      )}
    </section>
  );
}

function Pagination({
  page,
  pageCount,
  onPage,
}: {
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
}) {
  return (
    <div className="mt-5 flex items-center justify-between gap-3 text-sm">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        <ChevronLeft className="size-4" />
        Vorige
      </Button>
      <span className="text-muted">
        Pagina {page} van {pageCount}
      </span>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={page >= pageCount}
        onClick={() => onPage(page + 1)}
      >
        Volgende
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("nl-NL", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
