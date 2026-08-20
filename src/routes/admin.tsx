import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  LogOut,
  Mail,
  ExternalLink,
  Package,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { OrderDetails, OrderStatusBadge } from "@/components/order-details";
import { Button } from "@/components/ui/button";
import {
  ALLOWED_ORDER_STATUS_TRANSITIONS,
  ORDER_STATUS_LABELS,
  type OrderStatus,
} from "@/lib/order-status";
import {
  getAdminSessionState,
  getAdminSummary,
  loginAdmin,
  logoutAdmin,
} from "@/lib/server/admin";
import { authEnabled, clearBearerToken } from "@/lib/auth/client";
import { listContactMessages, setContactHandled } from "@/lib/server/contact";
import { validateCheckoutAddress } from "@/lib/server/address-validation";
import {
  createMyParcelConcept,
  getOrderForAdmin,
  listOrders,
  refreshMyParcelTracking,
  requestMyParcelLabel,
  updateOrderAddress,
  updateOrderFulfillment,
  updateOrderStatus,
} from "@/lib/server/orders";
import {
  isUnauthorizedServerError,
  rateLimitFeedback,
} from "@/lib/server-error";
import { formatEuro } from "@/lib/utils";
import { PRODUCTS, getDefaultOptionId, getProduct } from "@/lib/product";
import type { TrackingStatus } from "@/lib/server/integrations/myparcel.server";

export const Route = createFileRoute("/admin")({
  component: AdminPage,
  head: () => ({
    meta: [
      { title: "Beheer | VOLT" },
      { name: "robots", content: "noindex, nofollow, noarchive" },
    ],
  }),
});

type OrderListResult = Awaited<ReturnType<typeof listOrders>>;
type AdminOrder = Awaited<ReturnType<typeof getOrderForAdmin>>;
type ContactListResult = Awaited<ReturnType<typeof listContactMessages>>;
type AdminSessionState = Awaited<ReturnType<typeof getAdminSessionState>>;
type AdminSummary = Awaited<ReturnType<typeof getAdminSummary>>;
type AdminAddressSuggestion = {
  address: {
    street: string;
    houseNumber: string;
    postcode: string;
    city: string;
    country: "NL" | "BE";
  };
  validationToken: string;
};

const inputClass =
  "h-11 w-full rounded-xl border border-border bg-bg px-3.5 text-sm text-fg outline-none ring-primary/30 placeholder:text-dim focus:border-primary focus:ring-2";

const shipmentTrackingLabels: Record<TrackingStatus, string> = {
  concept: "Concept",
  registered: "Aangemeld",
  handed_over: "Overgedragen",
  in_transit: "Onderweg",
  delivered: "Bezorgd",
  exception: "Vertraging of bijzonderheid",
  returned: "Retour",
  unknown: "Onbekend",
};

const shipmentLabelLabels = {
  not_requested: "Niet opgevraagd",
  requested: "Wordt opgevraagd",
  ready: "Klaar",
  failed: "Mislukt",
} as const;

const mailKindLabels: Record<string, string> = {
  contact_owner: "Nieuw contactbericht voor beheer",
  contact_customer: "Ontvangstbevestiging contact",
  order_confirmation_customer: "Bestelbevestiging klant",
  order_confirmation_owner: "Bestelbevestiging beheer",
  order_status_changed_customer: "Gewijzigde bestelstatus",
  order_address_changed_customer: "Gewijzigd bezorgadres",
  order_products_changed_customer: "Gewijzigde producten",
  account_verify: "Account bevestigen",
  account_password_reset: "Wachtwoord herstellen",
  guest_order_claim: "Gastbestelling koppelen",
};

function AdminPage() {
  const [session, setSession] = useState<AdminSessionState | null>(null);
  const [sessionError, setSessionError] = useState("");

  const loadSession = useCallback(async () => {
    setSessionError("");
    try {
      setSession(await getAdminSessionState());
    } catch {
      setSessionError(
        "Beheerconfiguratie of sessiestatus kon niet worden geladen.",
      );
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  if (sessionError) {
    return (
      <AdminFrame>
        <ErrorState message={sessionError} onRetry={loadSession} />
      </AdminFrame>
    );
  }

  if (session === null) {
    return (
      <AdminFrame>
        <p className="inline-flex items-center gap-2 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" />
          Beheer laden…
        </p>
      </AdminFrame>
    );
  }

  if (!session.authenticated) {
    return (
      <AdminFrame>
        <AdminLogin
          passwordLoginAvailable={session.passwordLoginAvailable}
          allowlistConfigured={authEnabled && session.allowlistConfigured}
          onSuccess={loadSession}
        />
      </AdminFrame>
    );
  }

  return (
    <AdminFrame>
      <AdminDashboard onUnauthorized={loadSession} />
    </AdminFrame>
  );
}

function AdminFrame({ children }: { children: ReactNode }) {
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
          <Link
            to="/"
            className="text-sm font-semibold text-muted hover:text-fg"
          >
            Terug naar winkel
          </Link>
        </div>
      </header>
      <main className="container-max section-pad py-8 md:py-12">
        {children}
      </main>
    </div>
  );
}

function AdminLogin({
  passwordLoginAvailable,
  allowlistConfigured,
  onSuccess,
}: {
  passwordLoginAvailable: boolean;
  allowlistConfigured: boolean;
  onSuccess: () => void | Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  if (!passwordLoginAvailable) {
    return (
      <section className="mx-auto mt-8 max-w-sm rounded-xl border border-border bg-surface p-6 text-center shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
          Beveiligd beheer
        </p>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight">
          Inloggen
        </h1>
        <p className="mt-2 text-sm text-muted">
          {allowlistConfigured
            ? "Log in met een toegestaan account om het beheer te openen."
            : "Er is nog geen beheermethode geconfigureerd."}
        </p>
        {allowlistConfigured && (
          <Button className="mt-5 w-full" asChild>
            <Link to="/login" search={{ redirect: "/admin" }}>
              Inloggen met account
            </Link>
          </Button>
        )}
      </section>
    );
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const fields = new FormData(event.currentTarget);
    try {
      await loginAdmin({
        data: { password: String(fields.get("password") ?? "") },
      });
      await onSuccess();
    } catch (caught) {
      setError(
        rateLimitFeedback(caught) ??
          "Inloggen mislukt. Controleer het wachtwoord en probeer later opnieuw.",
      );
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
        <p
          role="alert"
          className="mt-4 rounded-lg border border-danger/25 bg-danger/5 p-3 text-sm text-danger"
        >
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
      {allowlistConfigured && (
        <Button
          type="button"
          variant="secondary"
          className="mt-2 w-full"
          asChild
        >
          <Link to="/login" search={{ redirect: "/admin" }}>
            Inloggen met toegestaan account
          </Link>
        </Button>
      )}
    </form>
  );
}

function AdminDashboard({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [tab, setTab] = useState<"orders" | "contact">("orders");
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [summaryError, setSummaryError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [refreshing, setRefreshing] = useState(true);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [contactsLoading, setContactsLoading] = useState(false);
  const summaryRequestSequence = useRef(0);
  const ordersTabRef = useRef<HTMLButtonElement>(null);
  const contactTabRef = useRef<HTMLButtonElement>(null);
  const refreshBusy =
    refreshing || (tab === "orders" ? ordersLoading : contactsLoading);

  const refresh = useCallback(async () => {
    const requestSequence = ++summaryRequestSequence.current;
    setRefreshing(true);
    setSummaryError("");
    try {
      const next = await getAdminSummary();
      if (requestSequence === summaryRequestSequence.current) {
        setSummary(next);
      }
    } catch (error) {
      if (isUnauthorizedServerError(error)) {
        onUnauthorized();
        return;
      }
      if (requestSequence === summaryRequestSequence.current) {
        setSummaryError("De dagelijkse samenvatting kon niet worden geladen.");
      }
    } finally {
      if (requestSequence === summaryRequestSequence.current) {
        setRefreshing(false);
      }
    }
  }, [onUnauthorized]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshVersion]);

  const refreshAll = () => {
    setRefreshing(true);
    setRefreshVersion((value) => value + 1);
  };
  const handleOrdersLoading = useCallback(
    (loading: boolean) => setOrdersLoading(loading),
    [],
  );
  const handleContactsLoading = useCallback(
    (loading: boolean) => setContactsLoading(loading),
    [],
  );
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    let nextTab: "orders" | "contact" | null = null;
    if (event.key === "Home") {
      nextTab = "orders";
    } else if (event.key === "End") {
      nextTab = "contact";
    } else if (event.key === "ArrowLeft") {
      nextTab = tab === "orders" ? "contact" : "orders";
    } else if (event.key === "ArrowRight") {
      nextTab = tab === "contact" ? "orders" : "contact";
    }
    if (!nextTab) return;
    event.preventDefault();
    setTab(nextTab);
    (nextTab === "orders" ? ordersTabRef : contactTabRef).current?.focus();
  };

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            Dashboard
          </p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight">
            Shopbeheer
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={refreshBusy}
            onClick={refreshAll}
          >
            <RefreshCw
              className={`size-4 ${refreshBusy ? "animate-spin" : ""}`}
            />
            Vernieuwen
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              void logoutAdmin()
                .catch(() => undefined)
                .finally(() => {
                  clearBearerToken();
                  onUnauthorized();
                });
            }}
          >
            <LogOut className="size-4" />
            Uitloggen
          </Button>
        </div>
      </div>

      {summaryError ? (
        <div className="mt-6">
          <ErrorState message={summaryError} onRetry={refreshAll} />
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-3 gap-2 sm:gap-3">
          <SummaryCard
            label="Nieuw / in afwachting"
            value={summary?.pendingOrders}
            loading={refreshing && !summary}
          />
          <SummaryCard
            label="Te verwerken"
            value={summary?.processingOrders}
            loading={refreshing && !summary}
          />
          <SummaryCard
            label="Open contact"
            value={summary?.openContacts}
            loading={refreshing && !summary}
          />
        </div>
      )}

      {summary && summary.failedMails > 0 && (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-danger/25 bg-danger/5 p-4 text-sm"
        >
          <p className="font-bold">
            {summary.failedMails} mislukte e-mail
            {summary.failedMails === 1 ? " vraagt" : "s vragen"} controle
          </p>
          {summary.uncertainMails > 0 && (
            <p className="mt-1 text-muted">
              Bij {summary.uncertainMails} e-mail
              {summary.uncertainMails === 1 ? " is" : "s is"} de levering
              onzeker. Deze worden niet automatisch opnieuw verzonden.
              Controleer eerst de verzonden mailbox en de ontvanger om dubbele
              berichten te voorkomen.
            </p>
          )}
          <ul className="mt-3 space-y-2" aria-label="Mislukte e-mails">
            {summary.mailFailures.map((mail) => (
              <li
                key={mail.id}
                className="rounded-lg border border-danger/15 bg-surface px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-semibold">
                    {mailKindLabels[mail.kind] ?? "Transactionele e-mail"}
                  </span>
                  {mail.deliveryUncertain && (
                    <span className="rounded-full bg-star/15 px-2 py-0.5 text-xs font-semibold text-star">
                      Levering onzeker
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted">
                  {[mail.reference, mail.recipient, formatDate(mail.failedAt)]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </li>
            ))}
          </ul>
          {summary.failedMails > summary.mailFailures.length && (
            <p className="mt-2 text-xs text-muted">
              Alleen de 10 meest recente mislukte e-mails worden getoond.
            </p>
          )}
        </div>
      )}

      <div
        className="mt-7 flex gap-2 border-b border-border"
        role="tablist"
        aria-label="Beheeronderdelen"
      >
        <button
          ref={ordersTabRef}
          id="admin-orders-tab"
          type="button"
          role="tab"
          aria-selected={tab === "orders"}
          aria-controls="admin-orders-panel"
          tabIndex={tab === "orders" ? 0 : -1}
          onKeyDown={handleTabKeyDown}
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
          ref={contactTabRef}
          id="admin-contact-tab"
          type="button"
          role="tab"
          aria-selected={tab === "contact"}
          aria-controls="admin-contact-panel"
          tabIndex={tab === "contact" ? 0 : -1}
          onKeyDown={handleTabKeyDown}
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
        <div
          id="admin-orders-panel"
          role="tabpanel"
          aria-labelledby="admin-orders-tab"
        >
          <OrdersAdmin
            onUnauthorized={onUnauthorized}
            refreshVersion={refreshVersion}
            onDataChanged={refreshAll}
            onLoadingChange={handleOrdersLoading}
          />
        </div>
      ) : (
        <div
          id="admin-contact-panel"
          role="tabpanel"
          aria-labelledby="admin-contact-tab"
        >
          <ContactAdmin
            onUnauthorized={onUnauthorized}
            refreshVersion={refreshVersion}
            onDataChanged={refreshAll}
            onLoadingChange={handleContactsLoading}
          />
        </div>
      )}
    </div>
  );
}

function OrdersAdmin({
  onUnauthorized,
  refreshVersion,
  onDataChanged,
  onLoadingChange,
}: {
  onUnauthorized: () => void;
  refreshVersion: number;
  onDataChanged: () => void;
  onLoadingChange: (loading: boolean) => void;
}) {
  const [draftSearch, setDraftSearch] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<OrderStatus | "all">("all");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<OrderListResult | null>(null);
  const [selected, setSelected] = useState<AdminOrder | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [detailRequestedId, setDetailRequestedId] = useState<string | null>(
    null,
  );
  const [detailSaving, setDetailSaving] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const detailTriggerRef = useRef<HTMLElement | null>(null);
  const detailRequestSequence = useRef(0);
  const listRequestSequence = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const loadOrders = useCallback(async () => {
    const requestSequence = ++listRequestSequence.current;
    setLoading(true);
    onLoadingChange(true);
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
      if (requestSequence === listRequestSequence.current) setResult(next);
    } catch (caught) {
      if (isUnauthorizedServerError(caught)) {
        onUnauthorized();
        return;
      }
      if (requestSequence === listRequestSequence.current) {
        setError("Bestellingen konden niet worden geladen.");
      }
    } finally {
      if (requestSequence === listRequestSequence.current) {
        setLoading(false);
        onLoadingChange(false);
      }
    }
  }, [onLoadingChange, onUnauthorized, page, search, status]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders, refreshVersion]);

  const openOrder = async (id: string) => {
    if (detailSaving) return;
    const requestSequence = ++detailRequestSequence.current;
    detailTriggerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setDetailError("");
    setDetailRequestedId(id);
    setDetailLoadingId(id);
    setSelected(null);
    try {
      const order = await getOrderForAdmin({ data: { id } });
      if (requestSequence === detailRequestSequence.current) {
        setSelected(order);
      }
    } catch (caught) {
      if (isUnauthorizedServerError(caught)) {
        onUnauthorized();
        return;
      }
      if (requestSequence === detailRequestSequence.current) {
        setDetailError("Bestelling kon niet worden geopend.");
      }
    } finally {
      if (requestSequence === detailRequestSequence.current) {
        setDetailLoadingId(null);
      }
    }
  };

  const closeOrder = () => {
    detailRequestSequence.current += 1;
    setSelected(null);
    requestAnimationFrame(() => {
      const trigger = detailTriggerRef.current;
      if (trigger?.isConnected) trigger.focus();
      else searchInputRef.current?.focus();
    });
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
            ref={searchInputRef}
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

      {error && (
        <div className="mt-4">
          <ErrorState message={error} onRetry={loadOrders} />
        </div>
      )}
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
                  <tr key={order.id} className="hover:bg-bg-elevated">
                    <td className="px-4 py-3 whitespace-nowrap">
                      {formatDate(order.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        disabled={detailSaving || detailLoadingId === order.id}
                        onClick={() => void openOrder(order.id)}
                        className="font-bold text-primary underline-offset-4 hover:underline disabled:opacity-60"
                        aria-label={`Bekijk bestelling ${order.orderNumber}`}
                      >
                        {detailLoadingId === order.id
                          ? "Openen…"
                          : order.orderNumber}
                      </button>
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
                disabled={detailSaving || detailLoadingId === order.id}
                onClick={() => void openOrder(order.id)}
                className="w-full rounded-xl border border-border bg-surface p-4 text-left"
                aria-label={`Bekijk bestelling ${order.orderNumber}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-extrabold text-primary">
                      {order.orderNumber}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      {formatDate(order.createdAt)}
                    </p>
                  </div>
                  <OrderStatusBadge status={order.status} />
                </div>
                <p className="mt-3 text-sm font-semibold">{order.name}</p>
                <p className="break-all text-xs text-muted">{order.email}</p>
                <p className="mt-2 text-sm font-bold">
                  {formatEuro(order.totalCents)}
                </p>
              </button>
            ))}
          </div>
          {result?.orders.length === 0 && (
            <p className="mt-6 text-sm text-muted">
              Geen bestellingen gevonden.
            </p>
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

      {detailLoadingId && (
        <p
          className="mt-5 inline-flex items-center gap-2 text-sm text-muted"
          role="status"
        >
          <Loader2 className="size-4 animate-spin" />
          Bestelling openen…
        </p>
      )}
      {detailError && (
        <div className="mt-5">
          <ErrorState
            message={detailError}
            onRetry={() => {
              if (detailRequestedId) void openOrder(detailRequestedId);
            }}
          />
        </div>
      )}
      {selected && (
        <OrderAdminDetail
          order={selected}
          onUnauthorized={onUnauthorized}
          onClose={closeOrder}
          onSavingChange={setDetailSaving}
          onUpdated={(order) => {
            setSelected(order);
            onDataChanged();
          }}
        />
      )}
    </section>
  );
}

type AddressDraft = {
  name: string;
  phone: string;
  street: string;
  houseNumber: string;
  postcode: string;
  city: string;
  country: "NL" | "BE";
};

type FulfillmentDraftLine = {
  key: string;
  slug: string;
  optionId: string;
  qty: number;
};

function addressDraft(order: AdminOrder): AddressDraft {
  return {
    name: order.name,
    phone: order.phone ?? "",
    street: order.street,
    houseNumber: order.houseNumber,
    postcode: order.postcode,
    city: order.city,
    country: order.country,
  };
}

function fulfillmentDraft(order: AdminOrder): FulfillmentDraftLine[] {
  return order.fulfillmentLines.map((line) => ({
    key: line.id,
    slug: line.slug,
    optionId: line.optionId,
    qty: line.qty,
  }));
}

function normalizedAddress(value: AddressDraft) {
  const collapse = (text: string) => text.trim().replace(/\s+/g, " ");
  const compactPostcode = value.postcode
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  return {
    name: collapse(value.name),
    phone: collapse(value.phone),
    street: collapse(value.street),
    houseNumber: collapse(value.houseNumber),
    postcode:
      value.country === "NL" && compactPostcode.length === 6
        ? `${compactPostcode.slice(0, 4)} ${compactPostcode.slice(4)}`
        : compactPostcode,
    city: collapse(value.city),
    country: value.country,
  };
}

function fulfillmentSelectionKey(lines: readonly FulfillmentDraftLine[]) {
  return JSON.stringify(
    lines
      .map(({ slug, optionId, qty }) => ({ slug, optionId, qty }))
      .sort((left, right) =>
        `${left.slug}\0${left.optionId}`.localeCompare(
          `${right.slug}\0${right.optionId}`,
        ),
      ),
  );
}

function fulfillmentLockReason(order: AdminOrder): string | null {
  if (order.status === "shipped" || order.status === "cancelled") {
    return "Producten zijn vergrendeld omdat deze bestelling is verzonden of geannuleerd.";
  }
  if (
    order.shipment?.labelRequestedAt ||
    (order.shipment && order.shipment.labelStatus !== "not_requested")
  ) {
    return "Producten zijn vergrendeld omdat voor deze zending al een label is opgevraagd.";
  }
  if (
    order.shipment &&
    !["concept", "registered"].includes(order.shipment.trackingStatus)
  ) {
    return "Producten zijn vergrendeld omdat de zending al is overgedragen.";
  }
  return null;
}

function OrderAdminDetail({
  order,
  onUnauthorized,
  onClose,
  onSavingChange,
  onUpdated,
}: {
  order: AdminOrder;
  onUnauthorized: () => void;
  onClose: () => void;
  onSavingChange: (saving: boolean) => void;
  onUpdated: (order: AdminOrder) => void;
}) {
  const [status, setStatus] = useState<OrderStatus>(order.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editingAddress, setEditingAddress] = useState(false);
  const [editingProducts, setEditingProducts] = useState(false);
  const [labelUrl, setLabelUrl] = useState("");
  const [addressSuggestion, setAddressSuggestion] =
    useState<AdminAddressSuggestion | null>(null);
  const [address, setAddress] = useState<AddressDraft>(() =>
    addressDraft(order),
  );
  const [products, setProducts] = useState<FulfillmentDraftLine[]>(() =>
    fulfillmentDraft(order),
  );
  const detailRef = useRef<HTMLDivElement>(null);
  const nextStatuses = ALLOWED_ORDER_STATUS_TRANSITIONS[order.status];
  const editing = editingAddress || editingProducts;
  const productsLockReason = fulfillmentLockReason(order);
  const shipmentLocksAddress =
    order.shipment !== null &&
    ["pending", "ambiguous", "created"].includes(order.shipment.creationStatus);

  useEffect(() => {
    setStatus(order.status);
    if (!editingAddress) setAddress(addressDraft(order));
    if (!editingProducts) setProducts(fulfillmentDraft(order));
  }, [editingAddress, editingProducts, order]);

  useEffect(() => {
    setLabelUrl("");
    setAddressSuggestion(null);
  }, [order.id]);

  const checkCurrentAddress = async () => {
    setSaving(true);
    onSavingChange(true);
    setError("");
    setSuccess("");
    setAddressSuggestion(null);
    try {
      const result = await validateCheckoutAddress({
        data: {
          street: order.street,
          houseNumber: order.houseNumber,
          postcode: order.postcode,
          city: order.city,
          country: order.country,
        },
      });
      if (
        result.status === "needs_confirmation" &&
        result.normalizedAddress &&
        result.validationToken
      ) {
        setAddressSuggestion({
          address: {
            street: result.normalizedAddress.street,
            houseNumber: result.normalizedAddress.houseNumber,
            postcode: result.normalizedAddress.postcode,
            city: result.normalizedAddress.city,
            country: result.normalizedAddress.country as "NL" | "BE",
          },
          validationToken: result.validationToken,
        });
        setSuccess("Controleer de voorgestelde adrescorrectie.");
        return;
      }
      if (
        result.status !== "valid" ||
        !result.normalizedAddress ||
        !result.validationToken
      ) {
        setError(
          result.status === "invalid"
            ? "Dit adres kon niet worden gevonden. Controleer postcode en huisnummer."
            : "De adrescontrole is tijdelijk niet beschikbaar.",
        );
        return;
      }
      const updated = await updateOrderAddress({
        data: {
          id: order.id,
          expectedUpdatedAt: order.updatedAt,
          name: order.name,
          phone: order.phone ?? undefined,
          street: result.normalizedAddress.street,
          houseNumber: result.normalizedAddress.houseNumber,
          postcode: result.normalizedAddress.postcode,
          city: result.normalizedAddress.city,
          country: result.normalizedAddress.country as "NL" | "BE",
          addressValidationToken: result.validationToken,
        },
      });
      onUpdated(updated);
      setSuccess("Bezorgadres is gecontroleerd en klaar voor MyParcel.");
    } catch (caught) {
      if (isUnauthorizedServerError(caught)) {
        onUnauthorized();
      } else {
        setError(
          rateLimitFeedback(caught) ??
            (caught instanceof Error && caught.message
              ? caught.message
              : "Het adres kon niet worden gecontroleerd."),
        );
      }
    } finally {
      setSaving(false);
      onSavingChange(false);
    }
  };

  useEffect(() => {
    detailRef.current?.focus({ preventScroll: true });
    detailRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, [order.id]);

  const runMutation = async (
    action: () => Promise<AdminOrder>,
    successMessage: (updated: AdminOrder) => string,
  ) => {
    setSaving(true);
    onSavingChange(true);
    setError("");
    setSuccess("");
    try {
      const updated = await action();
      onUpdated(updated);
      setSuccess(successMessage(updated));
      return true;
    } catch (caught) {
      if (isUnauthorizedServerError(caught)) {
        onUnauthorized();
        return false;
      }
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : "De wijziging is niet opgeslagen. Vernieuw het overzicht en probeer opnieuw.",
      );
      return false;
    } finally {
      setSaving(false);
      onSavingChange(false);
    }
  };

  return (
    <div
      ref={detailRef}
      tabIndex={-1}
      className="mt-6 scroll-mt-6 rounded-xl border border-border bg-surface p-4 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:p-6"
      aria-label={`Besteldetail ${order.orderNumber}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted">Besteldetail</p>
          <h2 className="text-xl font-extrabold tracking-tight">
            {order.orderNumber}
          </h2>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          disabled={saving}
        >
          Sluiten
        </Button>
      </div>

      <section className="mt-5 rounded-xl border border-border bg-bg-elevated p-4">
        <h3 className="text-sm font-bold">Status</h3>
        {nextStatuses.length ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="space-y-1.5">
              <span className="text-xs font-semibold">Volgende status</span>
              <select
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as OrderStatus)
                }
                className={inputClass}
                disabled={saving || editing}
              >
                <option value={order.status}>Kies een volgende status</option>
                {nextStatuses.map((value) => (
                  <option key={value} value={value}>
                    {ORDER_STATUS_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>
            <Button
              type="button"
              disabled={saving || editing || status === order.status}
              onClick={async () => {
                if (
                  !window.confirm(
                    `Status wijzigen naar ${ORDER_STATUS_LABELS[status]}? De klant ontvangt hierover een e-mail.`,
                  )
                ) {
                  return;
                }
                await runMutation(
                  () =>
                    updateOrderStatus({
                      data: {
                        id: order.id,
                        expectedStatus: order.status,
                        status,
                      },
                    }),
                  (updated) =>
                    `Status bijgewerkt naar ${ORDER_STATUS_LABELS[updated.status]}.`,
                );
              }}
            >
              {saving ? "Opslaan…" : "Status opslaan"}
            </Button>
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted">
            Deze status is definitief en kan niet meer worden gewijzigd.
          </p>
        )}
      </section>

      <section className="mt-4 rounded-xl border border-border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold">MyParcel-verzending</h3>
            <p className="mt-1 text-xs text-muted">
              Maak eerst een concept. Het A6-label wordt alleen apart opgevraagd
              wanneer je daarvoor kiest.
            </p>
          </div>
          {!order.shipment && (
            <Button
              type="button"
              size="sm"
              disabled={
                saving ||
                editing ||
                order.addressValidationStatus !== "valid" ||
                !["paid", "packed"].includes(order.status)
              }
              onClick={() =>
                void runMutation(
                  () => createMyParcelConcept({ data: { id: order.id } }),
                  () => "MyParcel-concept veilig aangemaakt.",
                )
              }
            >
              Concept aanmaken
            </Button>
          )}
        </div>

        {order.addressValidationStatus !== "valid" && (
          <p className="mt-3 text-sm text-danger">
            Het bezorgadres is gewijzigd en moet opnieuw worden gecontroleerd
            voordat een zending kan worden aangemaakt.
          </p>
        )}
        {!order.shipment && !["paid", "packed"].includes(order.status) && (
          <p className="mt-3 text-sm text-muted">
            MyParcel wordt beschikbaar zodra de bestelling is betaald.
          </p>
        )}

        {order.shipment && (
          <div className="mt-3 space-y-3">
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted">Concept</dt>
                <dd className="font-semibold">
                  {order.shipment.creationStatus === "created"
                    ? "Aangemaakt"
                    : order.shipment.creationStatus === "ambiguous"
                      ? "Controle nodig"
                      : order.shipment.creationStatus === "failed"
                        ? "Mislukt"
                        : "Wordt aangemaakt"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Verzendstatus</dt>
                <dd className="font-semibold">
                  {shipmentTrackingLabels[order.shipment.trackingStatus]}
                </dd>
              </div>
              {order.shipment.barcode && (
                <div>
                  <dt className="text-xs text-muted">Barcode</dt>
                  <dd className="font-semibold">{order.shipment.barcode}</dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-muted">Label</dt>
                <dd className="font-semibold">
                  {shipmentLabelLabels[order.shipment.labelStatus]}
                </dd>
              </div>
            </dl>
            <div className="flex flex-wrap gap-2">
              {order.shipment.creationStatus !== "created" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={saving || editing}
                  onClick={() =>
                    void runMutation(
                      () => createMyParcelConcept({ data: { id: order.id } }),
                      () => "MyParcel-concept gecontroleerd en aangemaakt.",
                    )
                  }
                >
                  Concept opnieuw controleren
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    size="sm"
                    disabled={
                      saving ||
                      editing ||
                      order.status === "cancelled" ||
                      order.status === "shipped"
                    }
                    onClick={async () => {
                      if (
                        !window.confirm(
                          "A6-label bij MyParcel opvragen? Dit is een externe actie.",
                        )
                      ) {
                        return;
                      }
                      setSaving(true);
                      onSavingChange(true);
                      setError("");
                      setSuccess("");
                      setLabelUrl("");
                      try {
                        const result = await requestMyParcelLabel({
                          data: { id: order.id },
                        });
                        onUpdated(result.order);
                        setLabelUrl(result.downloadUrl);
                        setSuccess("A6-label staat klaar om te downloaden.");
                      } catch (caught) {
                        if (isUnauthorizedServerError(caught)) {
                          onUnauthorized();
                        } else {
                          setError(
                            caught instanceof Error && caught.message
                              ? caught.message
                              : "Het A6-label kon niet worden opgevraagd.",
                          );
                        }
                      } finally {
                        setSaving(false);
                        onSavingChange(false);
                      }
                    }}
                  >
                    A6-label opvragen
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={saving || editing}
                    onClick={() =>
                      void runMutation(
                        () =>
                          refreshMyParcelTracking({ data: { id: order.id } }),
                        () => "Tracking bijgewerkt.",
                      )
                    }
                  >
                    <RefreshCw className="size-4" aria-hidden />
                    Tracking verversen
                  </Button>
                </>
              )}
            </div>
            {labelUrl && (
              <a
                href={labelUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
              >
                Download A6-label
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            )}
            {order.shipment.trackingUrl && (
              <a
                href={order.shipment.trackingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
              >
                Open track &amp; trace
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            )}
          </div>
        )}
      </section>

      <section className="mt-4 rounded-xl border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold">Bezorgadres</h3>
            <p className="mt-1 text-xs text-muted">
              Bij opslaan ontvangt de klant een bevestiging per e-mail.
            </p>
          </div>
          {!editingAddress && (
            <div className="flex flex-wrap gap-2">
              {order.addressValidationStatus !== "valid" && (
                <Button
                  type="button"
                  size="sm"
                  disabled={saving || editingProducts}
                  onClick={() => void checkCurrentAddress()}
                >
                  Adres controleren
                </Button>
              )}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={saving || editingProducts || shipmentLocksAddress}
                onClick={() => {
                  setAddress(addressDraft(order));
                  setEditingAddress(true);
                  setAddressSuggestion(null);
                  setError("");
                  setSuccess("");
                }}
              >
                Adres wijzigen
              </Button>
            </div>
          )}
        </div>
        {editingAddress ? (
          <form
            className="mt-4 grid gap-3 sm:grid-cols-2"
            onSubmit={async (event) => {
              event.preventDefault();
              const nextAddress = normalizedAddress(address);
              if (
                JSON.stringify(nextAddress) ===
                JSON.stringify(normalizedAddress(addressDraft(order)))
              ) {
                setEditingAddress(false);
                setError("");
                setSuccess("Geen adreswijzigingen gevonden.");
                return;
              }
              if (
                !window.confirm(
                  "Bezorgadres opslaan? De klant ontvangt hierover een e-mail.",
                )
              ) {
                return;
              }
              const saved = await runMutation(
                () =>
                  updateOrderAddress({
                    data: {
                      id: order.id,
                      expectedUpdatedAt: order.updatedAt,
                      ...nextAddress,
                      phone: nextAddress.phone || undefined,
                    },
                  }),
                () => "Bezorgadres bijgewerkt en klantmail klaargezet.",
              );
              if (saved) setEditingAddress(false);
            }}
          >
            <AdminField
              label="Naam"
              value={address.name}
              onChange={(value) => setAddress({ ...address, name: value })}
              disabled={saving}
              required
            />
            <AdminField
              label="Telefoon"
              value={address.phone}
              onChange={(value) => setAddress({ ...address, phone: value })}
              disabled={saving}
            />
            <AdminField
              label="Straat"
              value={address.street}
              onChange={(value) => setAddress({ ...address, street: value })}
              disabled={saving}
              required
            />
            <AdminField
              label="Huisnummer"
              value={address.houseNumber}
              onChange={(value) =>
                setAddress({ ...address, houseNumber: value })
              }
              disabled={saving}
              required
            />
            <AdminField
              label="Postcode"
              value={address.postcode}
              onChange={(value) => setAddress({ ...address, postcode: value })}
              disabled={saving}
              required
            />
            <AdminField
              label="Plaats"
              value={address.city}
              onChange={(value) => setAddress({ ...address, city: value })}
              disabled={saving}
              required
            />
            <label className="space-y-1.5">
              <span className="text-xs font-semibold">Land</span>
              <select
                value={address.country}
                onChange={(event) =>
                  setAddress({
                    ...address,
                    country: event.target.value as "NL" | "BE",
                  })
                }
                className={inputClass}
                disabled={saving}
              >
                <option value="NL">Nederland</option>
                <option value="BE">België</option>
              </select>
            </label>
            <div className="flex items-end gap-2 sm:justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={saving}
                onClick={() => {
                  setAddress(addressDraft(order));
                  setEditingAddress(false);
                }}
              >
                Annuleren
              </Button>
              <Button type="submit" size="sm" disabled={saving}>
                {saving ? "Opslaan…" : "Adres opslaan"}
              </Button>
            </div>
          </form>
        ) : (
          <>
            <address className="mt-3 text-sm not-italic leading-relaxed text-muted">
              {order.name}
              <br />
              {order.street} {order.houseNumber}
              <br />
              {order.postcode} {order.city}
              <br />
              {order.country === "NL" ? "Nederland" : "België"}
            </address>
            {shipmentLocksAddress && (
              <p className="mt-2 text-xs text-muted">
                Het adres is vergrendeld omdat er al een MyParcel-concept
                bestaat.
              </p>
            )}
            {addressSuggestion && (
              <div className="mt-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
                <p className="text-sm font-bold">Voorgesteld adres</p>
                <p className="mt-1 text-sm text-muted">
                  {addressSuggestion.address.street}{" "}
                  {addressSuggestion.address.houseNumber}
                  <br />
                  {addressSuggestion.address.postcode}{" "}
                  {addressSuggestion.address.city}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={saving}
                    onClick={async () => {
                      const suggestion = addressSuggestion;
                      const saved = await runMutation(
                        () =>
                          updateOrderAddress({
                            data: {
                              id: order.id,
                              expectedUpdatedAt: order.updatedAt,
                              name: order.name,
                              phone: order.phone ?? undefined,
                              ...suggestion.address,
                              addressValidationToken:
                                suggestion.validationToken,
                            },
                          }),
                        () =>
                          "Adrescorrectie opgeslagen, gecontroleerd en klantmail klaargezet.",
                      );
                      if (saved) setAddressSuggestion(null);
                    }}
                  >
                    Correctie gebruiken
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={saving}
                    onClick={() => {
                      setAddressSuggestion(null);
                      setAddress(addressDraft(order));
                      setEditingAddress(true);
                    }}
                  >
                    Zelf aanpassen
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      <section className="mt-4 rounded-xl border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold">Te leveren producten</h3>
            <p className="mt-1 text-xs text-muted">
              Het betaalde bedrag en de originele orderregels veranderen niet.
            </p>
          </div>
          {!editingProducts && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={saving || editingAddress || Boolean(productsLockReason)}
              onClick={() => {
                setProducts(fulfillmentDraft(order));
                setEditingProducts(true);
                setError("");
                setSuccess("");
              }}
            >
              Producten wijzigen
            </Button>
          )}
        </div>
        {productsLockReason && (
          <p className="mt-3 text-sm text-muted">{productsLockReason}</p>
        )}
        {editingProducts ? (
          <form
            className="mt-4 space-y-3"
            onSubmit={async (event) => {
              event.preventDefault();
              const variants = products.map(
                (line) => `${line.slug}\0${line.optionId}`,
              );
              if (new Set(variants).size !== variants.length) {
                setError("Elke productoptie mag maar één keer voorkomen.");
                return;
              }
              if (
                fulfillmentSelectionKey(products) ===
                fulfillmentSelectionKey(fulfillmentDraft(order))
              ) {
                setEditingProducts(false);
                setError("");
                setSuccess("Geen productwijzigingen gevonden.");
                return;
              }
              if (
                !window.confirm(
                  "Te leveren producten opslaan? De klant ontvangt hierover een e-mail. Het betaalde bedrag blijft ongewijzigd.",
                )
              ) {
                return;
              }
              const saved = await runMutation(
                () =>
                  updateOrderFulfillment({
                    data: {
                      id: order.id,
                      expectedUpdatedAt: order.updatedAt,
                      lines: products.map(({ slug, optionId, qty }) => ({
                        slug,
                        optionId,
                        qty,
                      })),
                    },
                  }),
                () =>
                  "Te leveren producten bijgewerkt en klantmail klaargezet.",
              );
              if (saved) setEditingProducts(false);
            }}
          >
            {products.map((line, index) => {
              const product = getProduct(line.slug) ?? PRODUCTS[0];
              return (
                <div
                  key={line.key}
                  className="grid gap-2 rounded-lg border border-border bg-bg-elevated p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_5rem_auto] sm:items-end"
                >
                  <label className="space-y-1.5">
                    <span className="text-xs font-semibold">Product</span>
                    <select
                      value={line.slug}
                      onChange={(event) => {
                        const nextProduct = getProduct(event.target.value);
                        if (!nextProduct) return;
                        setProducts((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  slug: nextProduct.slug,
                                  optionId: getDefaultOptionId(nextProduct),
                                }
                              : item,
                          ),
                        );
                      }}
                      className={inputClass}
                      disabled={saving}
                    >
                      {PRODUCTS.map((item) => (
                        <option key={item.slug} value={item.slug}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-xs font-semibold">Optie</span>
                    <select
                      value={line.optionId}
                      onChange={(event) =>
                        setProducts((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, optionId: event.target.value }
                              : item,
                          ),
                        )
                      }
                      className={inputClass}
                      disabled={saving}
                    >
                      {product.options.length ? (
                        product.options.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))
                      ) : (
                        <option value="default">{product.unit}</option>
                      )}
                    </select>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-xs font-semibold">Aantal</span>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={line.qty}
                      onChange={(event) =>
                        setProducts((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  qty: Math.max(
                                    1,
                                    Math.min(
                                      10,
                                      Number(event.target.value) || 1,
                                    ),
                                  ),
                                }
                              : item,
                          ),
                        )
                      }
                      className={inputClass}
                      disabled={saving}
                      required
                    />
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={saving || products.length === 1}
                    onClick={() =>
                      setProducts((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                    aria-label={`Productregel ${index + 1} verwijderen`}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              );
            })}
            <div className="flex flex-wrap justify-between gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={saving || products.length >= 50}
                onClick={() => {
                  const product = PRODUCTS[0];
                  setProducts((current) => [
                    ...current,
                    {
                      key: `new-${Date.now()}-${current.length}`,
                      slug: product.slug,
                      optionId: getDefaultOptionId(product),
                      qty: 1,
                    },
                  ]);
                }}
              >
                <Plus className="size-4" />
                Product toevoegen
              </Button>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={saving}
                  onClick={() => {
                    setProducts(fulfillmentDraft(order));
                    setEditingProducts(false);
                  }}
                >
                  Annuleren
                </Button>
                <Button type="submit" size="sm" disabled={saving}>
                  {saving ? "Opslaan…" : "Producten opslaan"}
                </Button>
              </div>
            </div>
          </form>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {order.fulfillmentLines.map((line) => (
              <li key={line.id} className="flex justify-between gap-3">
                <span>
                  {line.name}{" "}
                  <span className="text-muted">{line.optionLabel}</span>
                </span>
                <strong>{line.qty}x</strong>
              </li>
            ))}
          </ul>
        )}
      </section>

      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
      {success && (
        <p
          role="status"
          aria-live="polite"
          className="mt-3 text-sm text-success"
        >
          {success}
        </p>
      )}
      <div className="mt-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-dim">
          Originele bestelling en betaald bedrag
        </p>
        <OrderDetails order={order} />
      </div>
    </div>
  );
}

function AdminField({
  label,
  value,
  onChange,
  disabled,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  required?: boolean;
}) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-semibold">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
        disabled={disabled}
        required={required}
      />
    </label>
  );
}

function ContactAdmin({
  onUnauthorized,
  refreshVersion,
  onDataChanged,
  onLoadingChange,
}: {
  onUnauthorized: () => void;
  refreshVersion: number;
  onDataChanged: () => void;
  onLoadingChange: (loading: boolean) => void;
}) {
  const [handled, setHandled] = useState(false);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ContactListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const listRequestSequence = useRef(0);

  const loadContacts = useCallback(async () => {
    const requestSequence = ++listRequestSequence.current;
    setLoading(true);
    onLoadingChange(true);
    setError("");
    try {
      const next = await listContactMessages({
        data: { handled, page, pageSize: 20 },
      });
      if (requestSequence === listRequestSequence.current) setResult(next);
    } catch (caught) {
      if (isUnauthorizedServerError(caught)) {
        onUnauthorized();
        return;
      }
      if (requestSequence === listRequestSequence.current) {
        setError("Contactberichten konden niet worden geladen.");
      }
    } finally {
      if (requestSequence === listRequestSequence.current) {
        setLoading(false);
        onLoadingChange(false);
      }
    }
  }, [handled, onLoadingChange, onUnauthorized, page]);

  useEffect(() => {
    void loadContacts();
  }, [loadContacts, refreshVersion]);

  return (
    <section className="mt-6">
      <div
        className="inline-flex rounded-full border border-border bg-surface p-1"
        role="group"
        aria-label="Contactberichten filteren"
      >
        <button
          type="button"
          aria-pressed={!handled}
          disabled={savingId !== null}
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
          aria-pressed={handled}
          disabled={savingId !== null}
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
      {success && (
        <p
          role="status"
          aria-live="polite"
          className="mt-4 text-sm text-success"
        >
          {success}
        </p>
      )}
      {error && (
        <div className="mt-4">
          <ErrorState message={error} onRetry={loadContacts} />
        </div>
      )}
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
                  <p className="break-all text-xs text-muted">
                    {message.email}
                  </p>
                  <p className="mt-1 text-xs text-dim">
                    {formatDate(message.createdAt)}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={message.handled ? "secondary" : "primary"}
                  disabled={savingId !== null}
                  onClick={async () => {
                    setSavingId(message.id);
                    setError("");
                    setSuccess("");
                    try {
                      const updated = await setContactHandled({
                        data: { id: message.id, handled: !message.handled },
                      });
                      setSuccess(
                        updated.handled
                          ? "Contactbericht gemarkeerd als afgehandeld."
                          : "Contactbericht opnieuw als open gemarkeerd.",
                      );
                      onDataChanged();
                    } catch (caught) {
                      if (isUnauthorizedServerError(caught)) {
                        onUnauthorized();
                        return;
                      }
                      setError("Contactstatus wijzigen is niet gelukt.");
                    } finally {
                      setSavingId(null);
                    }
                  }}
                >
                  {savingId === message.id ? (
                    "Opslaan…"
                  ) : message.handled ? (
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
            <p className="text-sm text-muted">
              Geen contactberichten in deze lijst.
            </p>
          )}
          {result && (
            <Pagination
              page={result.page}
              pageCount={result.pageCount}
              onPage={setPage}
              disabled={savingId !== null}
            />
          )}
        </div>
      )}
    </section>
  );
}

function SummaryCard({
  label,
  value,
  loading,
}: {
  label: string;
  value: number | undefined;
  loading: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="rounded-xl border border-border bg-surface p-3 shadow-sm sm:p-4"
    >
      <p className="text-[11px] font-semibold leading-tight text-muted sm:text-xs">
        {label}
      </p>
      <p className="mt-1 text-2xl font-extrabold tabular-nums text-fg">
        {loading ? "…" : (value ?? 0)}
      </p>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void | Promise<void>;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-xl border border-danger/25 bg-danger/5 p-4 text-sm text-danger sm:flex-row sm:items-center sm:justify-between"
    >
      <p>{message}</p>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => void onRetry()}
      >
        Opnieuw proberen
      </Button>
    </div>
  );
}

function Pagination({
  page,
  pageCount,
  onPage,
  disabled = false,
}: {
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mt-5 flex items-center justify-between gap-3 text-sm">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={disabled || page <= 1}
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
        disabled={disabled || page >= pageCount}
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
