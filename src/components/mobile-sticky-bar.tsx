import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ShoppingBag } from "lucide-react";
import { useCartStore, cartCount, useHasCartHydrated } from "@/lib/cart-store";
import { getProduct, unitPriceCents } from "@/lib/product";
import { formatEuro } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function MobileStickyBar() {
  const selectedSlug = useCartStore((s) => s.selectedSlug);
  const selectedOptionId = useCartStore((s) => s.selectedOptionId);
  const selectedQty = useCartStore((s) => s.selectedQty);
  const addToCart = useCartStore((s) => s.addToCart);
  const openCart = useCartStore((s) => s.openCart);
  const cartOpen = useCartStore((s) => s.cartOpen);
  const lines = useCartStore((s) => s.lines);
  const hydrated = useHasCartHydrated();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [visible, setVisible] = useState(false);

  const onProduct = pathname.startsWith("/product/");
  const product = getProduct(selectedSlug);
  const count = hydrated ? cartCount(lines) : 0;

  useEffect(() => {
    const onScroll = () => {
      const cta =
        document.querySelector("#prijzen .glow-primary") ??
        document.getElementById("prijzen") ??
        document.getElementById("producten");
      if (!cta) {
        setVisible(window.scrollY > 420);
        return;
      }
      const rect = cta.getBoundingClientRect();
      const pastHero = window.scrollY > 280;
      const ctaInView = rect.top < window.innerHeight - 96 && rect.bottom > 96;
      setVisible(pastHero && !ctaInView);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [pathname]);

  if (!visible || cartOpen || !product) return null;

  const cover = product.images[0];
  const price = unitPriceCents(product, selectedOptionId);

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
          <p className="truncate text-sm font-semibold text-fg">{product.name}</p>
          <p className="text-sm font-bold tabular-nums text-primary">{formatEuro(price)}</p>
        </div>
        <button
          type="button"
          onClick={openCart}
          className="relative flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-bg-elevated text-fg"
          aria-label={
            count > 0
              ? `Winkelwagen openen, ${count} product${count === 1 ? "" : "en"}`
              : "Winkelwagen openen"
          }
        >
          <ShoppingBag className="size-5" />
          {count > 0 && (
            <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-fg tabular-nums">
              {count}
            </span>
          )}
        </button>
        {onProduct ? (
          <Button
            size="md"
            className="shrink-0 glow-primary min-h-11"
            onClick={() => addToCart(product.slug, selectedOptionId, selectedQty)}
          >
            Kopen
          </Button>
        ) : (
          <Button size="md" className="shrink-0 glow-primary min-h-11" asChild>
            <Link to="/product/$slug" params={{ slug: product.slug }}>
              Bekijk
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
