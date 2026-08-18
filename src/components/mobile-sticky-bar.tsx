import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ShoppingBag } from "lucide-react";
import { useCartStore, cartCount } from "@/lib/cart-store";
import { getDefaultOptionId, getProduct, unitPriceCents } from "@/lib/product";
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
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [visible, setVisible] = useState(false);

  const onProduct = pathname.startsWith("/product/");
  const onStorefront = pathname === "/" || onProduct;
  const routeProduct = onProduct ? getProduct(pathname.split("/").filter(Boolean).at(-1)) : undefined;
  const product = routeProduct ?? getProduct(selectedSlug);
  const productIsSelected = product?.slug === selectedSlug;
  const optionId = productIsSelected
    ? selectedOptionId
    : product
      ? getDefaultOptionId(product)
      : selectedOptionId;
  const qty = productIsSelected ? selectedQty : 1;
  const count = cartCount(lines);

  useEffect(() => {
    const onScroll = () => {
      const section = document.getElementById("prijzen") ?? document.getElementById("producten");
      if (!section) {
        setVisible(window.scrollY > 420);
        return;
      }
      const rect = section.getBoundingClientRect();
      const pastHero = window.scrollY > 360;
      const buyInView = rect.top < window.innerHeight && rect.bottom > 80;
      setVisible(pastHero && !buyInView);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [pathname]);

  if (!onStorefront || !visible || cartOpen || !product) return null;

  const cover = product.images[0];
  const price = unitPriceCents(product, optionId);

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
            onClick={() => addToCart(product.slug, optionId, qty)}
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
