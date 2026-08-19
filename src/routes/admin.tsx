import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  LogOut,
  Mail,
  Package,
  RefreshCw,
  Search,
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
import {
  getOrderForAdmin,
  listOrders,
  updateOrderStatus,
} from "@/lib/server/orders";
import {
  isUnauthorizedServerError,
  rateLimitFeedback,
} from "@/lib/server-error";
import { formatEuro } from "@/lib/utils";

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

const inputClass =
  "h-11 w-full rounded-xl border border-border bg-bg px-3.5 text-sm text-fg outline-none ring-primary/30 placeholder:text-dim focus:border-primary focus:ring-2";

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
  const detailRef = useRef<HTMLDivElement>(null);
  const nextStatuses = ALLOWED_ORDER_STATUS_TRANSITIONS[order.status];

  useEffect(() => {
    setStatus(order.status);
  }, [order.status]);

  useEffect(() => {
    detailRef.current?.focus({ preventScroll: true });
    detailRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, [order.id]);

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
      {nextStatuses.length ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <label className="space-y-1.5">
            <span className="text-xs font-semibold">Volgende status</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as OrderStatus)}
              className={inputClass}
              disabled={saving}
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
            disabled={saving || status === order.status}
            onClick={async () => {
              if (
                !window.confirm(
                  `Status wijzigen naar ${ORDER_STATUS_LABELS[status]}?`,
                )
              ) {
                return;
              }
              setSaving(true);
              onSavingChange(true);
              setError("");
              setSuccess("");
              try {
                const updated = await updateOrderStatus({
                  data: {
                    id: order.id,
                    expectedStatus: order.status,
                    status,
                  },
                });
                onUpdated(updated);
                setSuccess(
                  `Status bijgewerkt naar ${ORDER_STATUS_LABELS[updated.status]}.`,
                );
              } catch (caught) {
                if (isUnauthorizedServerError(caught)) {
                  onUnauthorized();
                  return;
                }
                setError(
                  "Status wijzigen is niet gelukt. Vernieuw het overzicht en probeer opnieuw.",
                );
              } finally {
                setSaving(false);
                onSavingChange(false);
              }
            }}
          >
            {saving ? "Opslaan…" : "Status opslaan"}
          </Button>
        </div>
      ) : (
        <p className="mt-5 rounded-xl border border-border bg-bg-elevated p-3 text-sm text-muted">
          Deze status is definitief en kan niet meer worden gewijzigd.
        </p>
      )}
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
        <OrderDetails order={order} />
      </div>
    </div>
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
