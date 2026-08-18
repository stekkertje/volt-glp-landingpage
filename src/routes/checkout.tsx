import {
  createFileRoute,
  Link,
  useNavigate,
} from "@tanstack/react-router";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { ArrowLeft, Loader2, LockKeyhole } from "lucide-react";
import { SiteShell } from "@/components/site-shell";
import { Button } from "@/components/ui/button";
import { useCartStore } from "@/lib/cart-store";
import { createOrderSchema } from "@/lib/server/order-schema";
import { createOrder, getPricingPreview } from "@/lib/server/orders";
import { rateLimitFeedback } from "@/lib/server-error";
import { formatEuro } from "@/lib/utils";

export const Route = createFileRoute("/checkout")({
  component: CheckoutPage,
  head: () => ({
    meta: [
      { title: "Afrekenen | VOLT" },
      {
        name: "description",
        content: "Plaats je VOLT-bestelling voor levering in Nederland of België.",
      },
    ],
  }),
});

type PricingPreview = Awaited<ReturnType<typeof getPricingPreview>>;

const inputClass =
  "h-11 w-full rounded-xl border border-border bg-bg px-3.5 text-sm text-fg outline-none ring-primary/30 placeholder:text-dim focus:border-primary focus:ring-2";

function CheckoutPage() {
  const navigate = useNavigate();
  const lines = useCartStore((state) => state.lines);
  const discountCode = useCartStore((state) => state.discountCode);
  const discountApplied = useCartStore((state) => state.discountApplied);
  const clearCart = useCartStore((state) => state.clearCart);
  const pushToast = useCartStore((state) => state.pushToast);
  const [hydrated, setHydrated] = useState(() => useCartStore.persist.hasHydrated());
  const [pricing, setPricing] = useState<PricingPreview | null>(null);
  const [pricingError, setPricingError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const idempotencyKey = useRef<string | null>(null);
  const emptyRedirected = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = useCartStore.persist.onFinishHydration(() => setHydrated(true));
    void Promise.resolve(useCartStore.persist.rehydrate()).then(() => setHydrated(true));
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
    let active = true;
    setPricingError("");
    void getPricingPreview({
      data: {
        lines: lines.map(({ slug, optionId, qty }) => ({ slug, optionId, qty })),
        discountCode: discountApplied ? discountCode : undefined,
      },
    })
      .then((result) => {
        if (active) setPricing(result);
      })
      .catch(() => {
        if (!active) return;
        setPricing(null);
        setPricingError("De actuele totalen konden niet worden berekend.");
      });
    return () => {
      active = false;
    };
  }, [discountApplied, discountCode, hydrated, lines]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!lines.length || submitting) return;
    setSubmitting(true);
    setFormError("");
    setFieldErrors({});
    const form = event.currentTarget;
    const fields = new FormData(form);
    idempotencyKey.current ??= crypto.randomUUID();
    const validation = createOrderSchema.safeParse({
      name: String(fields.get("name") ?? ""),
      email: String(fields.get("email") ?? ""),
      phone: String(fields.get("phone") ?? ""),
      street: String(fields.get("street") ?? ""),
      houseNumber: String(fields.get("houseNumber") ?? ""),
      postcode: String(fields.get("postcode") ?? ""),
      city: String(fields.get("city") ?? ""),
      country: String(fields.get("country") ?? ""),
      note: String(fields.get("note") ?? ""),
      lines: lines.map(({ slug, optionId, qty }) => ({ slug, optionId, qty })),
      discountCode: discountApplied ? discountCode : undefined,
      idempotencyKey: idempotencyKey.current,
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

    try {
      const result = await createOrder({
        data: validation.data,
      });
      sessionStorage.setItem(
        `volt-order-recovery:${result.order.id}`,
        result.guestAccessToken,
      );
      emptyRedirected.current = true;
      clearCart();
      await navigate({
        to: "/bestelling/$id",
        params: { id: result.order.id },
      });
    } catch (error) {
      setFormError(
        rateLimitFeedback(error) ??
          "Bestelling plaatsen is niet gelukt. Je winkelwagen is bewaard. Controleer je gegevens en probeer opnieuw.",
      );
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setSubmitting(false);
    }
  };

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
              <h1 className="mt-2 text-3xl font-extrabold tracking-tight">
                Waar mogen we bezorgen?
              </h1>
              <p className="mt-2 max-w-xl text-sm text-muted">
                Je plaatst de bestelling als gast. Een account is niet nodig.
              </p>

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
                  <Field
                    label="Telefoon"
                    name="phone"
                    type="tel"
                    autoComplete="tel"
                    className="sm:col-span-2"
                    error={fieldErrors.phone}
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
                        fieldErrors.country ? "checkout-country-error" : undefined
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
                    Opmerking <span className="font-normal text-dim">(optioneel)</span>
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
                    Je ontvangt een betaalverzoek. Nog geen online betaling.
                  </p>
                </div>

                <Button
                  type="submit"
                  size="lg"
                  className="w-full glow-primary"
                  disabled={submitting || !pricing}
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
              <h2 className="text-lg font-extrabold tracking-tight">Je bestelling</h2>
              {pricing ? (
                <>
                  <div className="mt-4 divide-y divide-border">
                    {pricing.lines.map((line) => (
                      <div
                        key={`${line.slug}-${line.optionId}`}
                        className="grid grid-cols-[1fr_auto] gap-3 py-3 text-sm"
                      >
                        <div>
                          <p className="font-semibold">{line.name}</p>
                          <p className="text-xs text-muted">
                            {line.optionLabel} · {line.qty} stuks
                          </p>
                        </div>
                        <p className="font-semibold tabular-nums">
                          {formatEuro(line.lineTotalCents)}
                        </p>
                      </div>
                    ))}
                  </div>
                  <dl className="space-y-2 border-t border-border pt-4 text-sm">
                    <PriceRow label="Subtotaal" cents={pricing.subtotalCents} />
                    {pricing.stackDiscountCents > 0 && (
                      <PriceRow
                        label="Stapelkorting"
                        cents={-pricing.stackDiscountCents}
                        discount
                      />
                    )}
                    {pricing.codeDiscountCents > 0 && (
                      <PriceRow
                        label={`Kortingscode ${pricing.discountCode ?? ""}`}
                        cents={-pricing.codeDiscountCents}
                        discount
                      />
                    )}
                    <PriceRow
                      label="Verzending"
                      cents={pricing.shippingCents}
                      free={pricing.shippingCents === 0}
                    />
                    <div className="flex justify-between border-t border-border pt-3 text-base font-extrabold">
                      <dt>Totaal</dt>
                      <dd className="tabular-nums text-primary">
                        {formatEuro(pricing.totalCents)}
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-4 text-[11px] leading-relaxed text-dim">
                    Deze bedragen zijn opnieuw berekend op de server.
                  </p>
                </>
              ) : (
                <p className="mt-4 text-sm text-muted">
                  {pricingError || "Actuele totalen berekenen…"}
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
    <div className={`flex justify-between ${discount ? "text-success" : "text-muted"}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums text-current">
        {free ? "Gratis" : `${cents < 0 ? "−" : ""}${formatEuro(Math.abs(cents))}`}
      </dd>
    </div>
  );
}
