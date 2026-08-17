import { Link } from "@tanstack/react-router";
import { formatEuro } from "@/lib/utils";
import { Stars } from "@/components/stars";
import { Button } from "@/components/ui/button";
import { useCartStore } from "@/lib/cart-store";
import { getDefaultOptionId, type Product } from "@/lib/product";

export function ProductCard({ product }: { product: Product }) {
  const addToCart = useCartStore((s) => s.addToCart);
  const cover = product.images[0];

  return (
    <article className="surface-card flex flex-col overflow-hidden rounded-xl">
      <Link
        to="/product/$slug"
        params={{ slug: product.slug }}
        className="relative block bg-bg-elevated"
      >
        {cover && (
          <img
            src={cover.src}
            alt={cover.alt}
            width={800}
            height={800}
            className="aspect-square w-full object-cover"
            loading="lazy"
          />
        )}
        {product.badges.length > 0 && (
          <div className="absolute left-2 top-2 flex flex-wrap gap-1">
            {product.badges.map((b) => (
              <span
                key={b}
                className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary-fg"
              >
                {b}
              </span>
            ))}
          </div>
        )}
      </Link>
      <div className="flex flex-1 flex-col p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
          {product.subcat} · {product.form === "pen" ? "Pen" : "Vial"}
        </p>
        <Link
          to="/product/$slug"
          params={{ slug: product.slug }}
          className="mt-1 text-base font-bold tracking-tight text-fg hover:text-primary"
        >
          {product.name}
        </Link>
        <p className="mt-0.5 text-xs text-muted">{product.brand}</p>
        <div className="mt-2 flex items-center gap-1.5">
          <Stars rating={product.rating} size="sm" />
          <span className="text-xs tabular-nums text-muted">
            {product.rating} · {product.reviewCount}
          </span>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-lg font-extrabold tabular-nums tracking-tight text-fg">
            {formatEuro(product.priceCents)}
          </span>
          {product.compareAtCents && (
            <span className="text-xs text-dim line-through tabular-nums">
              {formatEuro(product.compareAtCents)}
            </span>
          )}
        </div>
        <p className="text-xs text-dim">{product.unit}</p>
        <p className="mt-1 min-h-8 text-[11px] leading-snug text-muted">
          {product.form === "vial"
            ? "Bac water inbegrepen · spuiten kies je op de productpagina"
            : "Gebruiksklaar · naalden inbegrepen"}
        </p>
        <div className="mt-4 flex gap-2">
          <Button asChild variant="secondary" size="sm" className="flex-1">
            <Link to="/product/$slug" params={{ slug: product.slug }}>
              Bekijk
            </Link>
          </Button>
          <Button
            size="sm"
            className="flex-1"
            onClick={() =>
              addToCart(product.slug, getDefaultOptionId(product), 1)
            }
          >
            In winkelwagen
          </Button>
        </div>
      </div>
    </article>
  );
}
