import { Check, Minus, Plus } from "lucide-react";
import {
  getDefaultOptionId,
  unitPriceCents,
  type Product,
} from "@/lib/product";
import { MAX_LINE_QTY, useCartStore } from "@/lib/cart-store";
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

  const optionId = product.options.length ? selectedOptionId : "default";
  const price = unitPriceCents(product, optionId);
  const shownTotal = price * qty;
  const baseOptionPrice = product.options[0]?.priceCents ?? product.priceCents;

  const onAdd = () => {
    addToCart(product.slug, optionId, qty);
  };

  return (
    <div className="space-y-4">
      {product.options.length > 0 && (
        <>
          <p className="text-xs text-muted leading-relaxed">
            Bac water: standaard inbegrepen
            <br />
            Insuline spuiten: niet inbegrepen. Kies of je deze als extra wilt
            nemen.
          </p>
          <div
            className="grid gap-2.5"
            role="radiogroup"
            aria-label="Kies extra's"
          >
            {product.options.map((p) => {
              const active = optionId === p.id;
              const extraCost = Math.max(0, p.priceCents - baseOptionPrice);
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
                      {extraCost > 0
                        ? `+ ${formatEuro(extraCost)}`
                        : "Bac water inbegrepen"}
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
            className="flex size-10 items-center justify-center text-muted hover:text-fg disabled:opacity-40"
            onClick={() => setSelectedQty(qty + 1)}
            disabled={qty >= MAX_LINE_QTY}
            aria-label="Aantal verhogen"
          >
            <Plus className="size-4" />
          </button>
        </div>
      </div>

      <Button size="lg" className="w-full glow-primary" onClick={onAdd}>
        {ctaLabel} · {formatEuro(shownTotal)}
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
    </div>
  );
}
