import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { Truck, MapPinned, Package, Headphones, Check, ShieldCheck, RotateCcw } from "lucide-react";
import {
  relatedProducts,
  type Product,
  getDefaultOptionId,
  unitPriceCents,
  compareAtCents,
  pricePerWeekCents,
  SITE,
} from "@/lib/product";
import { formatEuro } from "@/lib/utils";
import { SiteShell } from "@/components/site-shell";
import { ProductGallery } from "@/components/product-gallery";
import { PackSelector } from "@/components/pack-selector";
import { ProductCard } from "@/components/product-card";
import { Stars } from "@/components/stars";
import { useCartStore } from "@/lib/cart-store";

export function ProductPage({ product }: { product: Product }) {
  const setSelected = useCartStore((s) => s.setSelected);
  const selectedOptionId = useCartStore((s) =>
    s.selectedSlug === product.slug ? s.selectedOptionId : getDefaultOptionId(product),
  );

  useEffect(() => {
    setSelected(product.slug, getDefaultOptionId(product));
  }, [product.slug, product, setSelected]);

  const price = unitPriceCents(product, selectedOptionId);
  const compare = compareAtCents(product, selectedOptionId);
  const related = relatedProducts(product.slug, 3);
  const sibling = related.find((p) => p.subcat === product.subcat);

  return (
    <SiteShell>
      <section className="border-b border-border bg-bg-elevated">
        <div className="container-max section-pad py-10 md:py-16">
          <nav className="mb-6 text-xs text-muted" aria-label="Broodkruimel">
            <a href="/#top" className="hover:text-fg">
              Home
            </a>
            <span className="mx-1.5">/</span>
            <a href="/#producten" className="hover:text-fg">
              GLP-1 Afvallen
            </a>
            <span className="mx-1.5">/</span>
            <a href={`/#${product.subcat.toLowerCase()}`} className="hover:text-fg">
              {product.subcat}
            </a>
            <span className="mx-1.5">/</span>
            <span className="text-fg">{product.name}</span>
          </nav>

          <div className="grid gap-10 lg:grid-cols-2 lg:gap-16 items-start">
            <ProductGallery key={`${product.slug}-gallery`} images={product.images} />

            <div id="prijzen" className="min-w-0 scroll-mt-28">
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                {product.brand} · {product.subcat}
              </p>
              <h1 className="mt-1 text-3xl font-extrabold tracking-tight sm:text-4xl">
                {product.name}
              </h1>
              <p className="mt-2 text-sm text-muted">{product.listing}</p>

              <a
                href="/#beoordelingen"
                className="mt-3 flex flex-wrap items-center gap-2 rounded-full w-fit focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <Stars rating={product.rating} />
                <span className="text-sm font-semibold tabular-nums">{product.rating}</span>
                <span className="text-sm text-muted underline-offset-2 hover:underline">
                  · {product.reviewCount} beoordelingen
                </span>
              </a>

              {product.badges.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {product.badges.map((b) => (
                    <span
                      key={b}
                      className="rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary-fg"
                    >
                      {b}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-5 flex items-end gap-3">
                <p className="text-3xl font-extrabold tabular-nums tracking-tight text-primary">
                  {formatEuro(price)}
                </p>
                {compare && (
                  <p className="pb-1 text-sm text-dim line-through tabular-nums">
                    {formatEuro(compare)}
                  </p>
                )}
              </div>
              <p className="text-sm text-muted">{product.unit} per verpakking</p>
              <p className="mt-1 text-sm text-muted">
                Ongeveer {product.weeksAtStart} weken bij startdosis
                <span className="block tabular-nums">
                  {formatEuro(pricePerWeekCents(product, selectedOptionId))}/week
                </span>
              </p>
              {price < SITE.freeShippingCents && (
                <p className="mt-2 text-sm text-muted">
                  + €4,95 verzending · gratis vanaf {formatEuro(SITE.freeShippingCents)}
                </p>
              )}

              <p className="mt-4 text-sm leading-relaxed text-muted">{product.shortPitch}</p>

              <div className="mt-6 rounded-xl border border-border bg-surface p-5 sm:p-7 shadow-sm">
                <PackSelector key={`${product.slug}-buy`} product={product} />
              </div>
              {sibling && (
                <p className="mt-3 text-sm text-muted">
                  Liever {sibling.form === "pen" ? "een kant-en-klare pen" : "een vial"}?{" "}
                  <Link
                    to="/product/$slug"
                    params={{ slug: sibling.slug }}
                    className="font-semibold text-primary hover:underline"
                  >
                    {sibling.name}
                  </Link>
                </p>
              )}

              <ul className="mt-6 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                {[
                  { icon: Truck, t: "1–2 werkdagen NL/BE" },
                  { icon: MapPinned, t: "Track & trace code" },
                  { icon: Package, t: "Discreet verpakt" },
                  { icon: Headphones, t: "Hulp binnen 24 uur" },
                  { icon: ShieldCheck, t: "Labgetest per batch" },
                  { icon: RotateCcw, t: "30 dagen ongeopend retour" },
                ].map((x) => (
                  <li
                    key={x.t}
                    className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2.5 text-muted"
                  >
                    <x.icon className="size-4 text-primary shrink-0" aria-hidden />
                    <span>{x.t}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="container-max section-pad py-16 md:py-20">
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <h2 className="text-2xl font-extrabold tracking-tight">Waarom dit product</h2>
            <ul className="mt-4 space-y-3">
              {product.highlights.map((h) => (
                <li key={h} className="flex items-start gap-3 text-sm text-fg">
                  <Check className="size-4 shrink-0 text-primary mt-0.5" strokeWidth={2.75} />
                  {h}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-border bg-surface overflow-hidden">
            <div className="border-b border-border bg-bg-elevated px-5 py-4">
              <h3 className="font-bold tracking-tight">Samenstelling</h3>
              <p className="mt-1 text-xs text-muted">Per verpakking</p>
            </div>
            <div className="divide-y divide-border px-5">
              {product.composition.map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <span className="text-muted">{row.label}</span>
                  <span className="font-semibold tabular-nums text-fg">{row.value}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-border bg-bg-elevated px-5 py-4 space-y-1 text-xs text-dim leading-relaxed">
              <p>Frequentie: {product.frequency}</p>
              <p>Start: {product.doseBeginner}</p>
              <p>Gevorderd: {product.doseAdvanced}</p>
              <p>{product.usageNote}</p>
            </div>
          </div>
        </div>
      </section>

      {related.length > 0 && (
        <section className="border-t border-border bg-bg-elevated">
          <div className="container-max section-pad py-16">
            <h2 className="text-2xl font-extrabold tracking-tight mb-6">Andere sterkte / vorm</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((p) => (
                <ProductCard key={p.slug} product={p} />
              ))}
            </div>
          </div>
        </section>
      )}
    </SiteShell>
  );
}
