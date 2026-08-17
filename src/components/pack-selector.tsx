import { Check, Minus, Plus } from "lucide-react";
import {
  getDefaultOptionId,
  getOption,
  unitPriceCents,
  type Product,
} from "@/lib/product";
import { useCartStore, cartCount, stackDiscountPct } from "@/lib/cart-store";
import { formatEuro, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DeliveryPromise } from "@/components/delivery-promise";

export function PackSelector({
  product,
  ctaLabel = "In winkelwagen",
}: {
  product: Product;
  ctaLabel?: string;
}) {
  const addToCart = useCartStore((s) => s.addToCart);
  const selectedOptionId = useCartStore((s) =>
    s.selectedSlug === product.slug
      ? s.selectedOptionId
      : getDefaultOptionId(product),
  );
  const qty = useCartStore((s) =>
    s.selectedSlug === product.slug ? s.selectedQty : 1,
  );
  const setSelected = useCartStore((s) => s.setSelected);
  const setSelectedQty = useCartStore((s) => s.setSelectedQty);
  const lines = useCartStore((s) => s.lines);

  const optionId = product.options.length ? selectedOptionId : "default";
  const price = unitPriceCents(product, optionId);
  const option = getOption(product, optionId);
  const baseOptionPrice = product.options[0]?.priceCents ?? product.priceCents;
  const futureQty = cartCount(lines) + qty;
  const stackPct = stackDiscountPct(futureQty);
  const rawTotal = price * qty;
  const shownTotal = stackPct
    ? rawTotal - Math.round(rawTotal * (stackPct / 100))
    : rawTotal;

  const onAdd = () => {
    addToCart(product.slug, optionId, qty);
  };

  return (
    <div className="space-y-4">
      {product.options.length > 0 && (
        <>
          <p className="text-xs text-muted leading-relaxed">
            Bac water zit bij de vial. Insulinespuiten heb je nodig om te
            injecteren. Kies of je die extra wilt meenemen.
          </p>
          <div
            className="grid gap-2.5"
            role="radiogroup"
            aria-label="Kies extra's"
          >
            {product.options.map((p) => {
              const active = optionId === p.id;
              const surcharge = p.priceCents - baseOptionPrice;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setSelected(product.slug, p.id)}
                  className={cn(
                    "relative flex w-full items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                    active
                      ? "border-primary bg-primary/6 ring-1 ring-primary/25"
                      : "border-border bg-surface hover:border-border-strong hover:bg-bg-elevated",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-full border-2",
                      active
                        ? "border-primary bg-primary text-primary-fg"
                        : "border-dim",
                    )}
                  >
                    {active && <Check className="size-3" strokeWidth={3} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="font-semibold tracking-tight text-fg">
                      {p.label}
                    </span>
                    <span className="block text-xs text-muted">
                      {surcharge > 0
                        ? `${formatEuro(surcharge)} extra`
                        : "Vial en bac water inbegrepen"}
                    </span>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-lg font-extrabold tracking-tight tabular-nums text-fg">
                      {formatEuro(p.priceCents)}
                    </p>
                    {p.compareAtCents && (
                      <p className="text-xs text-dim line-through tabular-nums">
                        {formatEuro(p.compareAtCents)}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-muted">Aantal</span>
        <div className="inline-flex items-center rounded-full border border-border bg-bg-elevated">
          <button
            type="button"
            className="flex size-10 items-center justify-center text-muted hover:text-fg disabled:opacity-40"
            onClick={() => setSelectedQty(qty - 1)}
            disabled={qty <= 1}
            aria-label="Aantal verlagen"
          >
            <Minus className="size-4" />
          </button>
          <span
            className="min-w-8 text-center text-sm font-bold tabular-nums"
            aria-live="polite"
          >
            {qty}
          </span>
          <button
            type="button"
            className="flex size-10 items-center justify-center text-muted hover:text-fg"
            onClick={() => setSelectedQty(qty + 1)}
            aria-label="Aantal verhogen"
          >
            <Plus className="size-4" />
          </button>
        </div>
      </div>

      <Button size="lg" className="w-full glow-primary" onClick={onAdd}>
        {stackPct ? (
          <>
            {ctaLabel} · {formatEuro(shownTotal)}
            <span className="text-xs font-semibold opacity-90">
              −{stackPct}% stapel
            </span>
          </>
        ) : (
          <>
            {ctaLabel} · {formatEuro(shownTotal)}
          </>
        )}
      </Button>

      <div className="flex items-center gap-2 rounded-lg border border-border bg-bg-elevated px-3 py-2.5 text-sm">
        <span className="relative flex size-2.5 shrink-0">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-success/50 opacity-60" />
          <span className="relative inline-flex size-2.5 rounded-full bg-success" />
        </span>
        <span className="text-fg font-medium">Op voorraad</span>
        <span className="text-muted">· direct leverbaar</span>
      </div>

      <DeliveryPromise />

      <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 text-sm">
        <p className="font-semibold text-fg tracking-tight leading-snug">
          Stapelkorting
        </p>
        <p className="mt-1 text-xs text-muted leading-relaxed">
          5+ stuks: 10% extra · 10+ stuks: 20% extra.{" "}
          {stackPct
            ? "De korting is al verwerkt in de knop en wordt bevestigd in de winkelwagen."
            : "De korting wordt automatisch verwerkt in de winkelwagen."}
        </p>
      </div>

      {option && (
        <p className="text-center text-xs text-dim">
          Gekozen extra: {option.label}
        </p>
      )}
    </div>
  );
}
