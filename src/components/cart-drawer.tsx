import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { X, ShoppingBag, Minus, Plus, Trash2, ChevronDown } from "lucide-react";
import {
  useCartStore,
  cartCount,
  cartSubtotalCents,
  cartStackDiscountCents,
  cartShippingCents,
  stackDiscountPct,
  lineLabel,
  FREE_SHIPPING_CENTS,
} from "@/lib/cart-store";
import { getProduct, unitPriceCents } from "@/lib/product";
import { getPricingPreview } from "@/lib/server/orders";
import { formatEuro } from "@/lib/utils";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { Button } from "@/components/ui/button";

type PricingPreview = Awaited<ReturnType<typeof getPricingPreview>>;

export function CartDrawer() {
  const open = useCartStore((s) => s.cartOpen);
  const close = useCartStore((s) => s.closeCart);
  const lines = useCartStore((s) => s.lines);
  const setLineQty = useCartStore((s) => s.setLineQty);
  const removeLine = useCartStore((s) => s.removeLine);
  const clear = useCartStore((s) => s.clearCart);
  const discountCode = useCartStore((s) => s.discountCode);
  const discountApplied = useCartStore((s) => s.discountApplied);
  const setDiscountCode = useCartStore((s) => s.setDiscountCode);
  const applyDiscount = useCartStore((s) => s.applyDiscount);
  const removeDiscount = useCartStore((s) => s.removeDiscount);
  const [showCode, setShowCode] = useState(false);
  const [discountPricing, setDiscountPricing] = useState<{
    requestKey: string;
    preview: PricingPreview;
  } | null>(null);
  const [discountPricingError, setDiscountPricingError] = useState<{
    requestKey: string;
    message: string;
  } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const count = cartCount(lines);
  const subtotal = cartSubtotalCents(lines);
  const stackPct = stackDiscountPct(count);
  const stack = cartStackDiscountCents(subtotal, count);
  const afterStack = subtotal - stack;
  const normalizedDiscountCode = discountCode.trim().toUpperCase();
  const discountPricingInput = useMemo(
    () => ({
      lines: lines.map(({ slug, optionId, qty }) => ({ slug, optionId, qty })),
      discountCode: normalizedDiscountCode,
    }),
    [lines, normalizedDiscountCode],
  );
  const discountPricingRequestKey = useMemo(
    () => JSON.stringify(discountPricingInput),
    [discountPricingInput],
  );
  const currentDiscountPricing =
    discountApplied && discountPricing?.requestKey === discountPricingRequestKey
      ? discountPricing.preview
      : null;
  const currentDiscountPricingError =
    discountApplied &&
    discountPricingError?.requestKey === discountPricingRequestKey
      ? discountPricingError.message
      : "";
  const totalsReady = !discountApplied || Boolean(currentDiscountPricing);
  const displayedSubtotal = currentDiscountPricing?.subtotalCents ?? subtotal;
  const displayedStack = currentDiscountPricing?.stackDiscountCents ?? stack;
  const displayedAfterDiscount = currentDiscountPricing
    ? currentDiscountPricing.subtotalCents -
      currentDiscountPricing.stackDiscountCents -
      currentDiscountPricing.codeDiscountCents
    : afterStack;
  const shipping =
    currentDiscountPricing?.shippingCents ??
    cartShippingCents(displayedAfterDiscount);
  const total =
    currentDiscountPricing?.totalCents ?? displayedAfterDiscount + shipping;
  const freeShipLeft = Math.max(
    0,
    FREE_SHIPPING_CENTS - displayedAfterDiscount,
  );
  const freeShipPct = Math.min(
    100,
    Math.round((displayedAfterDiscount / FREE_SHIPPING_CENTS) * 100),
  );

  useEffect(() => {
    if (!open || !discountApplied || !lines.length) return;
    let active = true;
    setDiscountPricing(null);
    setDiscountPricingError(null);
    void getPricingPreview({ data: discountPricingInput })
      .then((preview) => {
        if (!active) return;
        setDiscountPricing({ requestKey: discountPricingRequestKey, preview });
      })
      .catch(() => {
        if (!active) return;
        setDiscountPricing(null);
        setDiscountPricingError({
          requestKey: discountPricingRequestKey,
          message:
            "Deze kortingscode kon niet worden berekend. Verwijder de code om verder te gaan.",
        });
      });
    return () => {
      active = false;
    };
  }, [
    discountApplied,
    discountPricingInput,
    discountPricingRequestKey,
    lines.length,
    open,
  ]);

  useDialogFocus(open, close, panelRef, closeButtonRef);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70]"
      role="dialog"
      aria-modal="true"
      aria-label="Winkelwagen"
    >
      <button
        type="button"
        className="absolute inset-0 bg-fg/25 backdrop-blur-sm"
        onClick={close}
        aria-label="Achtergrond sluiten"
      />
      <div
        ref={panelRef}
        className="absolute inset-x-0 bottom-0 mx-auto flex h-[min(92dvh,720px)] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-border bg-surface shadow-2xl sm:inset-y-0 sm:right-0 sm:left-auto sm:mx-0 sm:h-full sm:max-h-none sm:max-w-sm sm:rounded-none sm:rounded-l-2xl sm:border-y-0 sm:border-r-0"
      >
        <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between border-b border-border bg-surface px-5 py-4">
          <div className="flex items-center gap-2">
            <ShoppingBag className="size-5 text-primary" aria-hidden />
            <h2 className="text-lg font-bold tracking-tight">
              Winkelwagen
              {count > 0 && (
                <span className="ml-2 text-sm font-medium text-muted">
                  ({count})
                </span>
              )}
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={close}
            className="flex size-10 items-center justify-center rounded-full border border-border text-muted hover:text-fg"
            aria-label="Winkelwagen sluiten"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {count === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm text-muted">Je winkelwagen is leeg.</p>
              <Button
                className="mt-4"
                variant="secondary"
                onClick={close}
                asChild
              >
                <a href="/#producten">Bekijk producten</a>
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {lines.map((line) => {
                const product = getProduct(line.slug);
                if (!product) return null;
                const cover = product.images[0];
                const unit = unitPriceCents(product, line.optionId);
                return (
                  <div
                    key={`${line.slug}-${line.optionId}`}
                    className="flex gap-3 rounded-xl border border-border bg-bg-elevated p-3"
                  >
                    {cover && (
                      <img
                        src={cover.src}
                        alt=""
                        className="size-16 shrink-0 rounded-lg object-cover"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold tracking-tight text-fg text-sm">
                        {product.name}
                      </p>
                      <p className="text-xs text-muted">{lineLabel(line)}</p>
                      <p className="mt-1 text-sm font-bold tabular-nums text-primary">
                        {formatEuro(unit)}
                      </p>
                      <div className="mt-2 flex items-center gap-2">
                        <div className="inline-flex items-center rounded-full border border-border bg-surface">
                          <button
                            type="button"
                            className="flex size-9 items-center justify-center text-muted hover:text-fg"
                            onClick={() =>
                              setLineQty(line.slug, line.optionId, line.qty - 1)
                            }
                            aria-label="Aantal verlagen in winkelwagen"
                          >
                            <Minus className="size-3.5" />
                          </button>
                          <span className="min-w-6 text-center text-sm font-semibold tabular-nums">
                            {line.qty}
                          </span>
                          <button
                            type="button"
                            className="flex size-9 items-center justify-center text-muted hover:text-fg"
                            onClick={() =>
                              setLineQty(line.slug, line.optionId, line.qty + 1)
                            }
                            aria-label="Aantal verhogen in winkelwagen"
                          >
                            <Plus className="size-3.5" />
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeLine(line.slug, line.optionId)}
                          className="flex size-9 items-center justify-center rounded-full text-muted hover:bg-danger/10 hover:text-danger"
                          aria-label="Product verwijderen"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </div>
                    <p className="shrink-0 text-sm font-semibold tabular-nums">
                      {formatEuro(unit * line.qty)}
                    </p>
                  </div>
                );
              })}

              {totalsReady && (
                <div className="rounded-xl border border-border bg-surface p-3">
                  {freeShipLeft > 0 ? (
                    <p className="text-xs text-muted">
                      Nog{" "}
                      <strong className="text-fg">
                        {formatEuro(freeShipLeft)}
                      </strong>{" "}
                      tot gratis verzending
                    </p>
                  ) : (
                    <p className="text-xs font-semibold text-success">
                      Gratis verzending bereikt
                    </p>
                  )}
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-300"
                      style={{ width: `${freeShipPct}%` }}
                    />
                  </div>
                </div>
              )}

              <div>
                {discountApplied ? (
                  <div className="rounded-xl border border-border bg-bg-elevated p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold">
                        Kortingscode {normalizedDiscountCode}
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
                    {currentDiscountPricing ? (
                      <p className="mt-1 text-xs text-success">
                        Actuele korting gecontroleerd.
                      </p>
                    ) : currentDiscountPricingError ? (
                      <p className="mt-2 text-xs text-danger" role="alert">
                        {currentDiscountPricingError}
                      </p>
                    ) : (
                      <p
                        className="mt-1 text-xs text-muted"
                        role="status"
                        aria-live="polite"
                      >
                        Actuele korting berekenen…
                      </p>
                    )}
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowCode((v) => !v)}
                      className="flex w-full items-center justify-between text-sm font-medium text-muted hover:text-fg"
                    >
                      Heb je een kortingscode?
                      <ChevronDown
                        className={`size-4 transition ${showCode ? "rotate-180" : ""}`}
                        aria-hidden
                      />
                    </button>
                    {showCode && (
                      <form
                        className="mt-2 flex gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          applyDiscount();
                        }}
                      >
                        <input
                          value={discountCode}
                          onChange={(e) => setDiscountCode(e.target.value)}
                          placeholder="Code"
                          className="h-10 min-w-0 flex-1 rounded-full border border-border bg-bg-elevated px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                          aria-label="Kortingscode"
                        />
                        <Button type="submit" size="sm" variant="secondary">
                          Toepassen
                        </Button>
                      </form>
                    )}
                  </>
                )}
              </div>

              {totalsReady ? (
                <div className="space-y-2 border-t border-border pt-4 text-sm">
                  <div className="flex justify-between text-muted">
                    <span>Subtotaal</span>
                    <span className="tabular-nums text-fg">
                      {formatEuro(displayedSubtotal)}
                    </span>
                  </div>
                  {displayedStack > 0 && (
                    <div className="flex justify-between text-success">
                      <span>
                        Stapelkorting
                        {currentDiscountPricing ? "" : ` (${stackPct}%)`}
                      </span>
                      <span className="tabular-nums">
                        −{formatEuro(displayedStack)}
                      </span>
                    </div>
                  )}
                  {currentDiscountPricing &&
                    currentDiscountPricing.codeDiscountCents > 0 && (
                      <div className="flex justify-between text-success">
                        <span>
                          Kortingscode {currentDiscountPricing.discountCode}
                        </span>
                        <span className="tabular-nums">
                          −
                          {formatEuro(currentDiscountPricing.codeDiscountCents)}
                        </span>
                      </div>
                    )}
                  <div className="flex justify-between text-muted">
                    <span>Verzending</span>
                    <span className="tabular-nums text-fg">
                      {shipping === 0 ? "Gratis" : formatEuro(shipping)}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-border pt-2 text-base font-extrabold tracking-tight">
                    <span>Totaal</span>
                    <span className="tabular-nums text-primary">
                      {formatEuro(total)}
                    </span>
                  </div>
                </div>
              ) : (
                <p
                  className="border-t border-border pt-4 text-xs text-muted"
                  role="status"
                  aria-live="polite"
                >
                  Het actuele totaal verschijnt zodra de kortingscode is
                  gecontroleerd.
                </p>
              )}
            </div>
          )}
        </div>

        {count > 0 && (
          <div className="shrink-0 space-y-2 border-t border-border bg-surface px-5 py-4">
            <Button className="w-full glow-primary" size="lg" asChild>
              <Link to="/checkout" onClick={close}>
                Veilig afrekenen
              </Link>
            </Button>
            <Button variant="ghost" className="w-full" onClick={clear}>
              Winkelwagen legen
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
