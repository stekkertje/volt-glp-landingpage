import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Loader2, LockKeyhole } from "lucide-react";
import { SiteShell } from "@/components/site-shell";
import { Button } from "@/components/ui/button";
import { authEnabled } from "@/lib/auth/client";
import { useCartStore } from "@/lib/cart-store";
import {
  checkoutIdempotencyKeyFromSeed,
  finalizeCheckoutAttemptAfterSuccess,
  initializeCheckoutAttemptSeed,
  isCheckoutReplayExpiredError,
  markCheckoutCartEpochCompleted,
  markCheckoutAttemptReplayExpired,
  markCheckoutAttemptWithCommittedCart,
  prepareCheckoutAttemptSeedForSubmit,
  type CheckoutAttemptSeed,
} from "@/lib/checkout-idempotency";
import { stageOrderRecoveryCode } from "@/lib/order-recovery-memory";
import { createOrderSchema } from "@/lib/server/order-schema";
import { createOrder, getPricingPreview } from "@/lib/server/orders";
import { isConflictServerError, rateLimitFeedback } from "@/lib/server-error";
import { orderLineSummary } from "@/lib/product";
import { formatEuro } from "@/lib/utils";

export const Route = createFileRoute("/checkout")({
  component: CheckoutPage,
  head: () => ({
    meta: [
      { title: "Afrekenen | VOLT" },
      {
        name: "description",
        content:
          "Plaats je VOLT-bestelling voor levering in Nederland of België.",
      },
      { name: "robots", content: "noindex, nofollow, noarchive" },
    ],
  }),
});

type PricingPreview = Awaited<ReturnType<typeof getPricingPreview>>;
type ConfirmedOrder = {
  id: string;
  orderNumber: string;
};
type PricingInput = {
  lines: { slug: string; optionId: string; qty: number }[];
  discountCode?: string;
};

function pricingRequestKey(input: PricingInput): string {
  return JSON.stringify({
    discountCode: input.discountCode?.trim().toUpperCase() || null,
    lines: [...input.lines].sort((left, right) => {
      const leftKey = `${left.slug}\0${left.optionId}`;
      const rightKey = `${right.slug}\0${right.optionId}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    }),
  });
}

function currentPricingInput(): PricingInput {
  const state = useCartStore.getState();
  return {
    lines: state.lines.map(({ slug, optionId, qty }) => ({
      slug,
      optionId,
      qty,
    })),
    discountCode: state.discountApplied ? state.discountCode : undefined,
  };
}

const CONFIRMATION_NAVIGATION_FALLBACK_MS = 1_500;

function committedOrderPath(orderId: string): string {
  return `/bestelling/${encodeURIComponent(orderId)}`;
}

function anchorCommittedOrderUrl(orderId: string): boolean {
  if (typeof window === "undefined") return false;
  const orderPath = committedOrderPath(orderId);
  try {
    // Bypass the router's patched method for this crash-safety anchor. A hard
    // reload can then open the committed order through its HttpOnly cookie.
    const nativeReplaceState = window.History?.prototype?.replaceState;
    if (typeof nativeReplaceState === "function") {
      nativeReplaceState.call(
        window.history,
        window.history.state,
        "",
        orderPath,
      );
    } else {
      window.history.replaceState(window.history.state, "", orderPath);
    }
    return window.location.pathname === orderPath;
  } catch {
    // The committed fallback remains usable when browser history is blocked.
    return false;
  }
}

async function establishCommittedOrderUrl(
  navigation: Promise<unknown>,
  orderId: string,
): Promise<boolean> {
  let timer: number | undefined;
  const navigationOutcome = navigation.then(
    () => "resolved" as const,
    () => "rejected" as const,
  );
  const outcome = await Promise.race([
    navigationOutcome,
    new Promise<"timeout">((resolve) => {
      timer = window.setTimeout(
        () => resolve("timeout"),
        CONFIRMATION_NAVIGATION_FALLBACK_MS,
      );
    }),
  ]);
  if (timer !== undefined) window.clearTimeout(timer);

  const orderPath = committedOrderPath(orderId);
  if (outcome === "resolved" && window.location.pathname === orderPath) {
    return true;
  }
  // Rejection and a bounded navigation hang both receive a reload-safe native
  // URL. `navigationOutcome` keeps observing a promise that settles later.
  return anchorCommittedOrderUrl(orderId);
}

const inputClass =
  "h-11 w-full rounded-xl border border-border bg-bg px-3.5 text-sm text-fg outline-none ring-primary/30 placeholder:text-dim focus:border-primary focus:ring-2";
const replayExpiredFeedback =
  "De veilige herhaaltermijn van deze bestelling is verlopen. Plaats de bestelling niet opnieuw. Neem via Contact contact op en vermeld je e-mailadres, zodat we de bestaande bestelling kunnen terugvinden.";
const committedCartFeedback =
  "Deze bestelling is al geplaatst. De eerder opgeslagen winkelwagen kan niet opnieuw worden verstuurd. Maak de winkelwagen leeg en voeg producten opnieuw toe als je bewust een nieuwe bestelling wilt plaatsen. Neem via Contact contact op als je de bevestiging niet meer kunt openen.";

function CheckoutPage() {
  const navigate = useNavigate();
  const lines = useCartStore((state) => state.lines);
  const cartEpoch = useCartStore((state) => state.cartEpoch);
  const discountCode = useCartStore((state) => state.discountCode);
  const discountApplied = useCartStore((state) => state.discountApplied);
  const removeDiscount = useCartStore((state) => state.removeDiscount);
  const clearCart = useCartStore((state) => state.clearCart);
  const pushToast = useCartStore((state) => state.pushToast);
  // Keep the server and first client render identical. Zustand's persist API
  // exists only once browser storage is available.
  const [hydrated, setHydrated] = useState(false);
  const [pricing, setPricing] = useState<{
    requestKey: string;
    preview: PricingPreview;
  } | null>(null);
  const [pricingError, setPricingError] = useState<{
    requestKey: string;
    message: string;
  } | null>(null);
  const [checkoutAttemptReady, setCheckoutAttemptReady] = useState(false);
  const [checkoutAttemptBlocked, setCheckoutAttemptBlocked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmedOrder, setConfirmedOrder] = useState<ConfirmedOrder | null>(
    null,
  );
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const checkoutAttempt = useRef<CheckoutAttemptSeed | null>(null);
  const confirmedOrderRef = useRef<ConfirmedOrder | null>(null);
  const pricingRequestSequence = useRef(0);
  const emptyRedirected = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (formError) errorRef.current?.focus();
  }, [formError]);
  const pricingInput = useMemo<PricingInput>(
    () => ({
      lines: lines.map(({ slug, optionId, qty }) => ({
        slug,
        optionId,
        qty,
      })),
      discountCode: discountApplied ? discountCode : undefined,
    }),
    [discountApplied, discountCode, lines],
  );
  const activePricingRequestKey = useMemo(
    () => pricingRequestKey(pricingInput),
    [pricingInput],
  );
  const currentPricing =
    pricing?.requestKey === activePricingRequestKey ? pricing.preview : null;
  const currentPricingError =
    pricingError?.requestKey === activePricingRequestKey
      ? pricingError.message
      : "";

  useEffect(() => {
    let active = true;
    void initializeCheckoutAttemptSeed().then((attempt) => {
      if (!active) return;
      checkoutAttempt.current = attempt;
      setCheckoutAttemptReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const persist = useCartStore.persist;
    if (!persist) {
      setHydrated(true);
      return;
    }
    const unsubscribe = persist.onFinishHydration(() => setHydrated(true));
    void Promise.resolve(persist.rehydrate()).then(() => setHydrated(true));
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!hydrated || lines.length || emptyRedirected.current) return;
    emptyRedirected.current = true;
    pushToast(
      "Je winkelwagen is leeg",
      "Kies eerst een product voordat je afrekent.",
      "error",
    );
    void navigate({ to: "/", hash: "producten" });
  }, [hydrated, lines.length, navigate, pushToast]);

  useEffect(() => {
    if (!hydrated || !lines.length) return;
    const requestSequence = ++pricingRequestSequence.current;
    let active = true;
    setPricingError(null);
    void getPricingPreview({
      data: pricingInput,
    })
      .then((result) => {
        if (active && requestSequence === pricingRequestSequence.current) {
          setPricing({ requestKey: activePricingRequestKey, preview: result });
        }
      })
      .catch(() => {
        if (!active || requestSequence !== pricingRequestSequence.current) {
          return;
        }
        setPricing(null);
        setPricingError({
          requestKey: activePricingRequestKey,
          message: "De actuele totalen konden niet worden berekend.",
        });
      });
    return () => {
      active = false;
    };
  }, [activePricingRequestKey, hydrated, lines.length, pricingInput]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!lines.length || submitting || confirmedOrderRef.current) return;
    if (checkoutAttemptBlocked) {
      setFormError(replayExpiredFeedback);
      requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }
    if (!checkoutAttemptReady || !currentPricing) {
      setFormError("Wacht tot de actuele totalen zijn berekend.");
      requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }
    setSubmitting(true);
    setFormError("");
    setFieldErrors({});
    const form = event.currentTarget;
    const fields = new FormData(form);
    const validation = createOrderSchema.safeParse({
      name: String(fields.get("name") ?? ""),
      email: String(fields.get("email") ?? ""),
      phone: "",
      street: String(fields.get("street") ?? ""),
      houseNumber: String(fields.get("houseNumber") ?? ""),
      postcode: String(fields.get("postcode") ?? ""),
      city: String(fields.get("city") ?? ""),
      country: String(fields.get("country") ?? ""),
      note: String(fields.get("note") ?? ""),
      lines: lines.map(({ slug, optionId, qty }) => ({ slug, optionId, qty })),
      discountCode: discountApplied ? discountCode : undefined,
      idempotencyKey: "checkout-validation-placeholder",
    });
    if (!validation.success) {
      const nextErrors: Record<string, string> = {};
      for (const issue of validation.error.issues) {
        const field = String(issue.path[0] ?? "form");
        nextErrors[field] ??= issue.message;
      }
      setFieldErrors(nextErrors);
      setFormError("Controleer de gemarkeerde velden.");
      setSubmitting(false);
      const firstField = String(validation.error.issues[0]?.path[0] ?? "");
      requestAnimationFrame(() => {
        const target = form.querySelector<HTMLElement>(
          `[name="${CSS.escape(firstField)}"]`,
        );
        target?.focus();
      });
      return;
    }

    let submittedAttempt: CheckoutAttemptSeed | null = null;
    let result: Awaited<ReturnType<typeof createOrder>>;
    try {
      const now = Date.now();
      const preparation = await prepareCheckoutAttemptSeedForSubmit(
        checkoutAttempt.current,
        undefined,
        now,
        undefined,
        cartEpoch,
      );
      if (!preparation.ok) {
        if (preparation.reason === "replay-expired") {
          setCheckoutAttemptBlocked(true);
          setFormError(replayExpiredFeedback);
        } else if (preparation.reason === "committed-cart") {
          setCheckoutAttemptBlocked(true);
          setFormError(committedCartFeedback);
        } else if (preparation.reason === "completed-cart") {
          setCheckoutAttemptBlocked(true);
          setFormError(committedCartFeedback);
        } else if (preparation.reason === "stale") {
          setFormError(
            "Deze checkout is verlopen of in een ander tabblad gewijzigd of afgerond. Open de winkelwagen opnieuw om veilig verder te gaan.",
          );
        } else if (preparation.reason === "lock") {
          setFormError(
            "De veilige tabbladbeveiliging is niet beschikbaar of bezet. Sluit andere checkout-tabbladen of gebruik een recente browser en probeer opnieuw.",
          );
        } else {
          setFormError(
            "De veilige herhaalbeveiliging kon niet worden opgeslagen. Sta browseropslag toe en probeer opnieuw.",
          );
        }
        requestAnimationFrame(() => errorRef.current?.focus());
        setSubmitting(false);
        return;
      }
      const { attempt } = preparation;
      submittedAttempt = attempt;
      checkoutAttempt.current = attempt;
      const idempotencyKey = await checkoutIdempotencyKeyFromSeed(attempt.seed);
      if (
        pricingRequestKey(currentPricingInput()) !== activePricingRequestKey
      ) {
        setFormError(
          "Je winkelwagen is gewijzigd. Wacht op de nieuwe totalen en probeer opnieuw.",
        );
        requestAnimationFrame(() => errorRef.current?.focus());
        setSubmitting(false);
        return;
      }
      result = await createOrder({
        data: {
          ...validation.data,
          idempotencyKey,
        },
      });
    } catch (error) {
      if (isCheckoutReplayExpiredError(error)) {
        if (submittedAttempt) {
          await markCheckoutAttemptReplayExpired(submittedAttempt);
        }
        setCheckoutAttemptBlocked(true);
        setFormError(replayExpiredFeedback);
      } else if (isConflictServerError(error)) {
        setFormError(
          "Deze bestelling is al geplaatst. Heb je gegevens na de eerste verzendpoging gewijzigd? Zet de oorspronkelijke gegevens terug en probeer opnieuw om dezelfde bestelling veilig te openen.",
        );
      } else {
        setFormError(
          rateLimitFeedback(error) ??
            "Bestelling plaatsen is niet gelukt. Je winkelwagen is bewaard. Controleer je gegevens en probeer opnieuw.",
        );
      }
      requestAnimationFrame(() => errorRef.current?.focus());
      setSubmitting(false);
      return;
    }

    // `createOrder` has returned: from here on the order is committed. Make
    // recovery and a non-retryable success state available before any storage
    // or navigation work that can fail or wait.
    const committed = {
      id: result.order.id,
      orderNumber: result.order.orderNumber,
    };
    const confirmedAttempt = submittedAttempt!;
    stageOrderRecoveryCode(result.order.id, result.guestAccessToken);
    confirmedOrderRef.current = committed;
    setConfirmedOrder(committed);
    emptyRedirected.current = true;
    // Start router reconciliation in the next task so the HttpOnly response
    // cookie is committed before the confirmation loader reads it. Attach the
    // settlement handler before doing any destructive client cleanup.
    const confirmationNavigation = new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0);
    }).then(() =>
      navigate({
        to: "/bestelling/$id",
        params: { id: result.order.id },
        replace: true,
      }),
    );
    const committedUrlReady = await establishCommittedOrderUrl(
      confirmationNavigation,
      result.order.id,
    );
    if (!committedUrlReady) {
      // The order is committed, but neither router nor history has a proven
      // recovery URL. Preserve the cart and seed so a reload can safely replay
      // the same idempotency key instead of losing the only recovery path.
      setSubmitting(false);
      return;
    }

    const cartEpochPersistedCompleted =
      await markCheckoutCartEpochCompleted(cartEpoch);
    if (!cartEpochPersistedCompleted) {
      // Do not clear or rotate the original attempt when the terminal cart
      // generation cannot be proven durable. The seed marker keeps any old
      // persisted cart fail-closed after reload without storing checkout data.
      try {
        await markCheckoutAttemptWithCommittedCart(confirmedAttempt);
      } catch {
        // The in-memory committed state still prevents a second submit here.
      }
      checkoutAttempt.current = confirmedAttempt;
      setSubmitting(false);
      return;
    }

    let cartPersistedEmpty = false;
    try {
      clearCart();
      cartPersistedEmpty = true;
    } catch {
      // Zustand updates memory before its persistence write. Keep the original
      // attempt terminal as the old durable cart may still exist after reload.
      try {
        await markCheckoutAttemptWithCommittedCart(confirmedAttempt);
      } catch {
        // The in-memory committed state still prevents a second submit here.
      }
      checkoutAttempt.current = confirmedAttempt;
    }

    if (cartPersistedEmpty) {
      try {
        checkoutAttempt.current =
          await finalizeCheckoutAttemptAfterSuccess(confirmedAttempt);
      } catch {
        // Never turn post-commit cleanup into a failed-order message.
        try {
          await markCheckoutAttemptWithCommittedCart(confirmedAttempt);
        } catch {
          // The in-memory committed state still prevents a second submit here.
        }
        checkoutAttempt.current = confirmedAttempt;
      }
    }

    setSubmitting(false);
  };

  if (confirmedOrder) {
    return (
      <SiteShell>
        <main className="container-max section-pad py-16">
          <section
            className="mx-auto max-w-xl rounded-2xl border border-success/30 bg-surface p-6 shadow-sm sm:p-8"
            aria-live="polite"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-success">
              Bevestigd
            </p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight">
              Bestelling is geplaatst
            </h1>
            <p className="mt-3 text-sm text-muted">
              Bestelnummer:{" "}
              <strong className="text-fg">{confirmedOrder.orderNumber}</strong>
            </p>
            <p className="mt-2 text-sm text-muted">
              Open de bevestiging vóór je deze pagina herlaadt en bewaar de
              eenmalige herstelcode. Als gast kun je de bestelling op dit
              apparaat tot 72 uur na plaatsing openen.{" "}
              {authEnabled &&
                "Was je ingelogd, dan kun je gekoppelde bestellingen ook via je account openen. "}
              De code wordt voor je veiligheid niet bewaard of opnieuw getoond.
            </p>
            <Button asChild size="lg" className="mt-6">
              <Link to="/bestelling/$id" params={{ id: confirmedOrder.id }}>
                Open de bevestiging
              </Link>
            </Button>
          </section>
        </main>
      </SiteShell>
    );
  }

  if (!hydrated || !lines.length) {
    return (
      <SiteShell>
        <main className="container-max section-pad py-16">
          <p className="text-sm text-muted">Winkelwagen laden…</p>
        </main>
      </SiteShell>
    );
  }

  return (
    <SiteShell>
      <main className="border-b border-border bg-bg-elevated">
        <div className="container-max section-pad py-10 md:py-16">
          <Link
            to="/"
            hash="producten"
            className="inline-flex items-center gap-2 text-sm font-semibold text-muted hover:text-fg"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Terug naar producten
          </Link>

          <div className="mt-6 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_24rem]">
            <section>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
                Afrekenen
              </p>
              <h1 className="mt-2 whitespace-nowrap text-[clamp(1.55rem,7vw,1.875rem)] font-extrabold tracking-tight">
                Waar mogen we bezorgen?
              </h1>

              <form
                className="mt-8 space-y-6 rounded-xl border border-border bg-surface p-5 shadow-sm sm:p-7"
                onSubmit={onSubmit}
              >
                {formError && (
                  <div
                    ref={errorRef}
                    tabIndex={-1}
                    role="alert"
                    className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger outline-none"
                  >
                    {formError}
                  </div>
                )}

                <fieldset className="grid gap-4 sm:grid-cols-2">
                  <legend className="col-span-full mb-1 text-base font-bold">
                    Contactgegevens
                  </legend>
                  <Field
                    label="Naam"
                    name="name"
                    autoComplete="name"
                    required
                    error={fieldErrors.name}
                  />
                  <Field
                    label="E-mail"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    error={fieldErrors.email}
                  />
                </fieldset>

                <fieldset className="grid gap-4 sm:grid-cols-6">
                  <legend className="col-span-full mb-1 text-base font-bold">
                    Bezorgadres
                  </legend>
                  <Field
                    label="Straat"
                    name="street"
                    autoComplete="address-line1"
                    required
                    className="sm:col-span-4"
                    error={fieldErrors.street}
                  />
                  <Field
                    label="Huisnummer"
                    name="houseNumber"
                    autoComplete="address-line2"
                    required
                    className="sm:col-span-2"
                    error={fieldErrors.houseNumber}
                  />
                  <Field
                    label="Postcode"
                    name="postcode"
                    autoComplete="postal-code"
                    required
                    className="sm:col-span-2"
                    error={fieldErrors.postcode}
                  />
                  <Field
                    label="Plaats"
                    name="city"
                    autoComplete="address-level2"
                    required
                    className="sm:col-span-2"
                    error={fieldErrors.city}
                  />
                  <label className="space-y-1.5 sm:col-span-2">
                    <span className="text-xs font-semibold text-fg">Land</span>
                    <select
                      name="country"
                      autoComplete="country"
                      defaultValue="NL"
                      className={inputClass}
                      aria-invalid={Boolean(fieldErrors.country)}
                      aria-describedby={
                        fieldErrors.country
                          ? "checkout-country-error"
                          : undefined
                      }
                    >
                      <option value="NL">Nederland</option>
                      <option value="BE">België</option>
                    </select>
                    {fieldErrors.country && (
                      <span
                        id="checkout-country-error"
                        role="alert"
                        className="block text-xs text-danger"
                      >
                        {fieldErrors.country}
                      </span>
                    )}
                  </label>
                </fieldset>

                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-fg">
                    Opmerking{" "}
                    <span className="font-normal text-dim">(optioneel)</span>
                  </span>
                  <textarea
                    name="note"
                    rows={4}
                    maxLength={1_000}
                    className={`${inputClass} h-auto min-h-24 resize-y py-3`}
                    placeholder="Bijvoorbeeld een bezorginstructie"
                    aria-invalid={Boolean(fieldErrors.note)}
                    aria-describedby={
                      fieldErrors.note ? "checkout-note-error" : undefined
                    }
                  />
                  {fieldErrors.note && (
                    <span
                      id="checkout-note-error"
                      role="alert"
                      className="block text-xs text-danger"
                    >
                      {fieldErrors.note}
                    </span>
                  )}
                </label>

                <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                  <p className="flex items-start gap-2 text-sm font-semibold text-fg">
                    <LockKeyhole className="mt-0.5 size-4 shrink-0 text-primary" />
                    Betaalinformatie staat op de volgende pagina en in je
                    e-mail.
                  </p>
                </div>

                <Button
                  type="submit"
                  size="lg"
                  className="w-full glow-primary"
                  disabled={
                    submitting ||
                    checkoutAttemptBlocked ||
                    !checkoutAttemptReady ||
                    !currentPricing
                  }
                  aria-busy={submitting}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                      Bestelling plaatsen…
                    </>
                  ) : (
                    "Bestelling plaatsen"
                  )}
                </Button>
              </form>
            </section>

            <aside className="rounded-xl border border-border bg-surface p-5 shadow-sm lg:sticky lg:top-28">
              <h2 className="text-lg font-extrabold tracking-tight">
                Je bestelling
              </h2>
              {discountApplied && !currentPricingError && (
                <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-elevated px-3 py-2">
                  <p className="text-xs font-semibold">
                    Kortingscode {discountCode.trim().toUpperCase()}
                  </p>
                  <button
                    type="button"
                    onClick={removeDiscount}
                    aria-label="Kortingscode verwijderen"
                    className="text-xs font-bold text-danger underline underline-offset-2"
                  >
                    Verwijderen
                  </button>
                </div>
              )}
              {currentPricing ? (
                <>
                  <div className="mt-4 divide-y divide-border">
                    {currentPricing.lines.map((line) => (
                      <div
                        key={`${line.slug}-${line.optionId}`}
                        className="grid grid-cols-[1fr_auto] gap-3 py-3 text-sm"
                      >
                        <div>
                          <p className="font-semibold">{line.name}</p>
                          <p className="text-xs text-muted">
                            {orderLineSummary(
                              line.slug,
                              line.optionLabel,
                              line.qty,
                            )}
                          </p>
                        </div>
                        <p className="font-semibold tabular-nums">
                          {formatEuro(line.lineTotalCents)}
                        </p>
                      </div>
                    ))}
                  </div>
                  <dl className="space-y-2 border-t border-border pt-4 text-sm">
                    <PriceRow
                      label="Subtotaal"
                      cents={currentPricing.subtotalCents}
                    />
                    {currentPricing.stackDiscountCents > 0 && (
                      <PriceRow
                        label="Stapelkorting"
                        cents={-currentPricing.stackDiscountCents}
                        discount
                      />
                    )}
                    {currentPricing.codeDiscountCents > 0 && (
                      <PriceRow
                        label={`Kortingscode ${currentPricing.discountCode ?? ""}`}
                        cents={-currentPricing.codeDiscountCents}
                        discount
                      />
                    )}
                    <PriceRow
                      label="Verzending"
                      cents={currentPricing.shippingCents}
                      free={currentPricing.shippingCents === 0}
                    />
                    <div className="flex justify-between border-t border-border pt-3 text-base font-extrabold">
                      <dt>Totaal</dt>
                      <dd className="tabular-nums text-primary">
                        {formatEuro(currentPricing.totalCents)}
                      </dd>
                    </div>
                  </dl>
                </>
              ) : currentPricingError && discountApplied ? (
                <div
                  className="mt-4 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger"
                  role="alert"
                >
                  <p>{currentPricingError}</p>
                  <button
                    type="button"
                    onClick={removeDiscount}
                    className="mt-2 font-bold underline underline-offset-2"
                  >
                    Kortingscode verwijderen en opnieuw berekenen
                  </button>
                </div>
              ) : (
                <p
                  className="mt-4 text-sm text-muted"
                  role="status"
                  aria-live="polite"
                >
                  {currentPricingError || "Actuele totalen berekenen…"}
                </p>
              )}
            </aside>
          </div>
        </div>
      </main>
    </SiteShell>
  );
}

function Field({
  label,
  name,
  type = "text",
  autoComplete,
  required = false,
  className = "",
  error,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  className?: string;
  error?: string;
}) {
  const errorId = `checkout-${name}-error`;
  return (
    <label className={`space-y-1.5 ${className}`}>
      <span className="text-xs font-semibold text-fg">{label}</span>
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        className={inputClass}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
      />
      {error && (
        <span id={errorId} role="alert" className="block text-xs text-danger">
          {error}
        </span>
      )}
    </label>
  );
}

function PriceRow({
  label,
  cents,
  discount = false,
  free = false,
}: {
  label: string;
  cents: number;
  discount?: boolean;
  free?: boolean;
}) {
  return (
    <div
      className={`flex justify-between ${discount ? "text-success" : "text-muted"}`}
    >
      <dt>{label}</dt>
      <dd className="tabular-nums text-current">
        {free
          ? "Gratis"
          : `${cents < 0 ? "−" : ""}${formatEuro(Math.abs(cents))}`}
      </dd>
    </div>
  );
}
