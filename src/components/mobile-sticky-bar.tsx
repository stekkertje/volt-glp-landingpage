import { useRouterState } from "@tanstack/react-router";
import { ShoppingBag } from "lucide-react";
import {
  useCartStore,
  cartCount,
  cartSubtotalCents,
  cartStackDiscountCents,
} from "@/lib/cart-store";
import { getProduct } from "@/lib/product";
import { formatEuro } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function MobileStickyBar() {
  const openCart = useCartStore((s) => s.openCart);
  const cartOpen = useCartStore((s) => s.cartOpen);
  const lines = useCartStore((s) => s.lines);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const onProduct = pathname.startsWith("/product/");
  const onStorefront = pathname === "/" || onProduct;
  const count = cartCount(lines);
  const subtotal = cartSubtotalCents(lines);
  const shownTotal = subtotal - cartStackDiscountCents(subtotal, count);
  const first = lines[0] ? getProduct(lines[0].slug) : undefined;
  const cover = first?.images[0];

  if (!onStorefront || cartOpen || count === 0 || !first) return null;

  return (
    <div className="fixed inset-x-0 z-[66] border-t border-border bg-surface/95 p-3 shadow-[0_-8px_30px_-12px_rgba(20,19,26,0.15)] backdrop-blur-xl md:hidden pb-[max(0.75rem,env(safe-area-inset-bottom))] bottom-[var(--volt-cookie-h,0px)]">
      <div className="flex items-center gap-3">
        {cover && (
          <img
            src={cover.src}
            alt=""
            className="size-12 rounded-lg object-cover ring-1 ring-border"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-fg">Winkelwagen</p>
          <p className="text-sm font-bold tabular-nums text-primary">
            {formatEuro(shownTotal)}
          </p>
        </div>
        <button
          type="button"
          onClick={openCart}
          className="relative flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-bg-elevated text-fg"
          aria-label={
            count === 1
              ? "Winkelwagen openen, 1 product"
              : `Winkelwagen openen, ${count} producten`
          }
        >
          <ShoppingBag className="size-5" />
          <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-fg tabular-nums">
            {count}
          </span>
        </button>
        <Button
          size="md"
          className="shrink-0 glow-primary min-h-11"
          onClick={openCart}
        >
          Mandje
        </Button>
      </div>
    </div>
  );
}
