import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CheckCircle2,
  ChevronDown,
  Link2,
  Loader2,
  LockKeyhole,
  PackageSearch,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { OrderDetails, OrderStatusBadge } from "@/components/order-details";
import { SiteShell } from "@/components/site-shell";
import { Button } from "@/components/ui/button";
import { authClient, authEnabled } from "@/lib/auth/client";
import { UserButton } from "@/lib/auth/gates";
import { useCurrentUserState, type AppUser } from "@/lib/auth/use-current-user";
import {
  confirmGuestOrderClaim,
  listAccountOrders,
  requestGuestOrderClaim,
} from "@/lib/server/account";
import type { AccountOrder } from "@/lib/server/account.server";
import { rateLimitFeedback } from "@/lib/server-error";
import { formatEuro } from "@/lib/utils";

export const Route = createFileRoute("/account")({
  component: AccountPage,
  head: () => ({
    meta: [
      { title: "Mijn account | Afslank-injecties.nl" },
      { name: "robots", content: "noindex, nofollow, noarchive" },
    ],
  }),
});

const CLAIM_SESSION_KEY = "volt-account-order-claim";
const inputClass =
  "h-11 w-full rounded-xl border border-border bg-bg px-3.5 text-sm text-fg outline-none ring-primary/30 placeholder:text-dim focus:border-primary focus:ring-2";

function readAndStageClaimToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const fromUrl = hash.get("claim");
    if (fromUrl && /^[A-Za-z0-9_-]{40,100}$/.test(fromUrl)) {
      window.sessionStorage.setItem(CLAIM_SESSION_KEY, fromUrl);
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
      return fromUrl;
    }
    return window.sessionStorage.getItem(CLAIM_SESSION_KEY);
  } catch {
    return null;
  }
}

function clearClaimToken(): void {
  try {
    window.sessionStorage.removeItem(CLAIM_SESSION_KEY);
  } catch {
    // Opslag is niet beschikbaar. De server maakt een gebruikte token ongeldig.
  }
}

function AccountPage() {
  const { user, isPending } = useCurrentUserState();
  const [claimToken, setClaimToken] = useState<string | null>(null);

  useEffect(() => {
    const syncClaimToken = () => setClaimToken(readAndStageClaimToken());
    syncClaimToken();
    window.addEventListener("hashchange", syncClaimToken);
    return () => window.removeEventListener("hashchange", syncClaimToken);
  }, []);

  return (
    <SiteShell>
      <main className="border-b border-border bg-bg-elevated">
        <div className="container-max section-pad py-10 md:py-16">
          <div className="mx-auto max-w-4xl">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
              Account
            </p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight">
              Mijn account
            </h1>
            <p className="mt-2 text-sm text-muted">
              Bekijk je bestelgegevens, het vastgelegde bestelbedrag en je
              verzendstatus.
            </p>

            {isPending ? (
              <p className="mt-8 inline-flex items-center gap-2 text-sm text-muted">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Account laden…
              </p>
            ) : user && !user.isDevFallback ? (
              <SignedInAccount user={user} initialClaimToken={claimToken} />
            ) : (
              <SignedOutAccount
                authUnavailable={!authEnabled}
                hasPendingClaim={Boolean(claimToken)}
              />
            )}
          </div>
        </div>
      </main>
    </SiteShell>
  );
}

function SignedOutAccount({
  authUnavailable,
  hasPendingClaim,
}: {
  authUnavailable: boolean;
  hasPendingClaim: boolean;
}) {
  return (
    <section className="mt-8 rounded-xl border border-border bg-surface p-6 text-center shadow-sm">
      <LockKeyhole className="mx-auto size-6 text-primary" aria-hidden />
      <h2 className="mt-3 text-xl font-extrabold tracking-tight">
        {authUnavailable
          ? "Account tijdelijk niet beschikbaar"
          : "Log in om je bestellingen te bekijken"}
      </h2>
      <p className="mx-auto mt-2 max-w-lg text-sm text-muted">
        {authUnavailable
          ? "Je kunt momenteel geen account openen. Neem contact op als je hulp nodig hebt bij een bestelling."
          : hasPendingClaim
            ? "Log in met het e-mailadres waarop je de bevestigingslink ontving. Daarna wordt de koppeling veilig afgerond."
            : "Alleen jij krijgt na inloggen toegang tot de bestellingen die aan je account zijn gekoppeld."}
      </p>
      {!authUnavailable && (
        <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
          <Button asChild>
            <Link to="/login" search={{ redirect: "/account" }}>
              Inloggen
            </Link>
          </Button>
          <Button asChild variant="secondary">
            <Link to="/registreren">Account aanmaken</Link>
          </Button>
        </div>
      )}
    </section>
  );
}

function SignedInAccount({
  user,
  initialClaimToken,
}: {
  user: AppUser;
  initialClaimToken: string | null;
}) {
  const [orders, setOrders] = useState<AccountOrder[] | null>(null);
  const [ordersError, setOrdersError] = useState("");
  const [claimStatus, setClaimStatus] = useState<
    | { kind: "idle" }
    | { kind: "confirming" }
    | { kind: "success"; message: string }
    | { kind: "error"; message: string }
  >({ kind: initialClaimToken ? "confirming" : "idle" });
  const claimAttemptedToken = useRef<string | null>(null);

  const loadOrders = useCallback(async () => {
    setOrdersError("");
    try {
      setOrders(await listAccountOrders());
    } catch {
      setOrdersError("Je bestellingen konden niet worden geladen.");
    }
  }, []);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    if (
      !initialClaimToken ||
      claimAttemptedToken.current === initialClaimToken
    ) {
      return;
    }
    claimAttemptedToken.current = initialClaimToken;
    setClaimStatus({ kind: "confirming" });
    void confirmGuestOrderClaim({ data: { token: initialClaimToken } })
      .then(async ({ linkedOrders }) => {
        clearClaimToken();
        setClaimStatus({
          kind: "success",
          message:
            linkedOrders === 0
              ? "De bevestiging is verwerkt. Er stonden geen nieuwe gastbestellingen klaar."
              : linkedOrders === 1
                ? "Eén eerdere gastbestelling is veilig gekoppeld."
                : `${linkedOrders} eerdere gastbestellingen zijn veilig gekoppeld.`,
        });
        await loadOrders();
      })
      .catch((error) => {
        clearClaimToken();
        setClaimStatus({
          kind: "error",
          message:
            rateLimitFeedback(error) ??
            "Deze bevestigingslink is ongeldig, verlopen of al gebruikt.",
        });
      });
  }, [initialClaimToken, loadOrders]);

  return (
    <div className="mt-8 space-y-6">
      <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
        <UserButton />
        <p className="text-xs text-muted">
          Alleen zichtbaar binnen jouw account
        </p>
      </section>

      {claimStatus.kind === "confirming" && (
        <p
          role="status"
          className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface p-4 text-sm text-muted"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Bevestiging verwerken…
        </p>
      )}
      {claimStatus.kind === "success" && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-xl border border-success/25 bg-success/5 p-4 text-sm text-success"
        >
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
          {claimStatus.message}
        </p>
      )}
      {claimStatus.kind === "error" && (
        <p
          role="alert"
          className="rounded-xl border border-danger/25 bg-danger/5 p-4 text-sm text-danger"
        >
          {claimStatus.message}
        </p>
      )}

      <section aria-labelledby="account-orders-title">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2
              id="account-orders-title"
              className="text-xl font-extrabold tracking-tight"
            >
              Bestelgeschiedenis
            </h2>
            <p className="mt-1 text-sm text-muted">
              Prijzen en adressen zijn de gegevens zoals vastgelegd bij iedere
              bestelling.
            </p>
          </div>
        </div>
        {ordersError && (
          <p
            role="alert"
            className="mt-4 rounded-xl border border-danger/25 bg-danger/5 p-4 text-sm text-danger"
          >
            {ordersError}
          </p>
        )}
        {!orders && !ordersError && (
          <p className="mt-4 text-sm text-muted">Bestellingen laden…</p>
        )}
        {orders?.length === 0 && (
          <div className="mt-4 rounded-xl border border-border bg-surface p-6 text-center">
            <PackageSearch
              className="mx-auto size-6 text-primary"
              aria-hidden
            />
            <p className="mt-3 text-sm text-muted">
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
          <div className="mt-4 space-y-4">
            {orders.map((order) => (
              <AccountOrderCard key={order.id} order={order} />
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <GuestOrderClaimPanel email={user.primaryEmail ?? "je e-mailadres"} />
        <ChangePasswordPanel />
      </div>
    </div>
  );
}

function AccountOrderCard({ order }: { order: AccountOrder }) {
  return (
    <details className="group rounded-xl border border-border bg-surface shadow-sm">
      <summary className="flex list-none cursor-pointer flex-wrap items-center justify-between gap-4 p-4 marker:content-none sm:p-5">
        <div>
          <p className="font-extrabold tracking-tight">{order.orderNumber}</p>
          <p className="mt-1 text-xs text-muted">
            {new Intl.DateTimeFormat("nl-NL", { dateStyle: "medium" }).format(
              new Date(order.createdAt),
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <p className="text-sm font-bold tabular-nums text-primary">
            {formatEuro(order.totalCents)}
          </p>
          <OrderStatusBadge status={order.status} />
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-muted">
            Details
            <ChevronDown
              className="size-4 transition-transform group-open:rotate-180"
              aria-hidden
            />
          </span>
        </div>
      </summary>
      <div className="border-t border-border p-4 sm:p-5">
        <OrderDetails order={order} />
        <Button asChild variant="secondary" className="mt-5">
          <Link to="/bestelling/$id" params={{ id: order.id }}>
            Volledige bestelpagina
          </Link>
        </Button>
      </div>
    </details>
  );
}

function GuestOrderClaimPanel({ email }: { email: string }) {
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const requestClaim = async () => {
    setSubmitting(true);
    setMessage("");
    setError("");
    try {
      const result = await requestGuestOrderClaim({ data: {} });
      setMessage(result.message);
    } catch (claimError) {
      setError(
        rateLimitFeedback(claimError) ??
          "De bevestigingsmail kon niet worden aangevraagd.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="rounded-xl border border-border bg-surface p-5 shadow-sm">
      <Link2 className="size-5 text-primary" aria-hidden />
      <h2 className="mt-3 text-lg font-extrabold tracking-tight">
        Eerdere bestellingen koppelen
      </h2>
      <p className="mt-2 text-sm text-muted">
        We sturen een veilige bevestigingslink naar {email}. Pas na die
        bevestiging koppelen we eerdere gastbestellingen met hetzelfde
        e-mailadres.
      </p>
      {message && (
        <p role="status" className="mt-3 text-sm text-success">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
      <Button
        type="button"
        variant="secondary"
        className="mt-4"
        disabled={submitting}
        onClick={requestClaim}
      >
        {submitting && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {submitting ? "Versturen…" : "Bevestigingslink sturen"}
      </Button>
    </section>
  );
}

function ChangePasswordPanel() {
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const newPassword = String(fields.get("newPassword") ?? "");
    setMessage("");
    setError("");
    if (newPassword !== String(fields.get("confirmation") ?? "")) {
      setError("De nieuwe wachtwoorden zijn niet gelijk.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await authClient.changePassword({
        currentPassword: String(fields.get("currentPassword") ?? ""),
        newPassword,
        revokeOtherSessions: true,
      });
      if (result.error) {
        setError(
          "Het huidige wachtwoord is onjuist of wijzigen is niet mogelijk.",
        );
        return;
      }
      form.reset();
      setMessage("Je wachtwoord is gewijzigd. Andere sessies zijn uitgelogd.");
    } catch {
      setError("Je wachtwoord kon niet worden gewijzigd.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="rounded-xl border border-border bg-surface p-5 shadow-sm">
      <LockKeyhole className="size-5 text-primary" aria-hidden />
      <h2 className="mt-3 text-lg font-extrabold tracking-tight">
        Wachtwoord wijzigen
      </h2>
      {message && (
        <p role="status" className="mt-3 text-sm text-success">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
      <form onSubmit={onSubmit} className="mt-4 space-y-3">
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold">Huidig wachtwoord</span>
          <input
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            className={inputClass}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold">Nieuw wachtwoord</span>
          <input
            name="newPassword"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
            className={inputClass}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold">
            Herhaal nieuw wachtwoord
          </span>
          <input
            name="confirmation"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
            className={inputClass}
          />
        </label>
        <Button type="submit" variant="secondary" disabled={submitting}>
          {submitting && (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          )}
          {submitting ? "Opslaan…" : "Wachtwoord wijzigen"}
        </Button>
      </form>
    </section>
  );
}
