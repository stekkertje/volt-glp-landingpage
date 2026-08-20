import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Truck,
  ShieldCheck,
  Package,
  Rocket,
  ArrowRight,
  Check,
  FlaskConical,
} from "lucide-react";
import {
  SITE,
  SUBCATS,
  PRODUCTS,
  BENEFITS,
  COMPOUNDS,
  FORM_COMPARE,
  REVIEWS,
  FAQS,
  RATING_BREAKDOWN,
  DEFAULT_PRODUCT_SLUG,
  productsBySubcat,
  type Subcat,
} from "@/lib/product";
import { formatEuro, cn } from "@/lib/utils";
import { SiteShell } from "@/components/site-shell";
import { ProductCard } from "@/components/product-card";
import { Stars } from "@/components/stars";
import { BenefitIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useCartStore } from "@/lib/cart-store";

const PRODUCT_HASHES = new Set([
  "semaglutide",
  "tirzepatide",
  "retatrutide",
  "producten",
]);

function hashToFilter(hash: string): Subcat | "all" | null {
  const h = hash.replace("#", "").toLowerCase();
  if (h === "semaglutide") return "Semaglutide";
  if (h === "tirzepatide") return "Tirzepatide";
  if (h === "retatrutide") return "Retatrutide";
  if (h === "producten") return "all";
  return null;
}

export function LandingPage() {
  const setSelected = useCartStore((s) => s.setSelected);
  const [filter, setFilter] = useState<Subcat | "all">("all");

  useEffect(() => {
    const apply = () => {
      const raw = window.location.hash.replace("#", "").toLowerCase();
      const next = hashToFilter(window.location.hash);
      if (next !== null) {
        setFilter(next);
        const stickyProduct =
          next === "all"
            ? DEFAULT_PRODUCT_SLUG
            : productsBySubcat(next)[0]?.slug;
        if (stickyProduct) setSelected(stickyProduct);
      }
      if (PRODUCT_HASHES.has(raw)) {
        requestAnimationFrame(() => {
          document
            .getElementById("producten")
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [setSelected]);

  const setFilterAndHash = (id: Subcat | "all") => {
    setFilter(id);
    const stickyProduct =
      id === "all" ? DEFAULT_PRODUCT_SLUG : productsBySubcat(id)[0]?.slug;
    if (stickyProduct) setSelected(stickyProduct);
    const item = SUBCATS.find((s) => s.id === id);
    if (item) {
      history.replaceState(null, "", `/#${item.hash}`);
    }
  };

  const visible = useMemo(() => productsBySubcat(filter), [filter]);
  const weekdeal = PRODUCTS.find((p) => p.weekdeal);
  const featured = weekdeal ?? PRODUCTS[0]!;
  const catalogFilters = SUBCATS.filter((s) => s.id !== "all");

  return (
    <SiteShell>
      <section className="hero-grid relative overflow-hidden">
        <div className="container-max section-pad py-10 md:py-16 lg:py-20">
          <div className="grid items-center gap-10 md:grid-cols-2 md:gap-12">
          <div className="order-1 space-y-6 min-w-0">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
                {SITE.brand}
              </p>
              <h1 className="text-4xl font-extrabold tracking-tight text-fg sm:text-5xl lg:text-[3.4rem] lg:leading-[1.05]">
                {SITE.headline}
              </h1>
              <p className="max-w-lg text-base text-muted sm:text-lg sm:leading-relaxed">
                {SITE.shortPitch}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <a
                href="#beoordelingen"
                className="flex flex-wrap items-center gap-2 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <Stars rating={SITE.rating} />
                <span className="text-sm font-semibold tabular-nums">
                    {SITE.rating}
                  </span>
                  <span className="text-sm text-muted underline-offset-2 hover:underline">
                    {SITE.reviewCount.toLocaleString("nl-NL")} beoordelingen
                  </span>
                </a>
              </div>

            <div className="rounded-xl border border-border bg-surface p-4 shadow-sm sm:p-5 space-y-4">
              {weekdeal && (
                <>
                  <Link
                    to="/product/$slug"
                    params={{ slug: weekdeal.slug }}
                    className="flex w-full flex-col gap-1 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2.5 text-left transition hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-primary">
                          Weekdeal −20%
                        </p>
                        <p className="text-sm font-bold tracking-tight text-fg">
                          {weekdeal.name}
                      </p>
                      <p className="text-xs text-success font-semibold">
                        {formatEuro(weekdeal.priceCents)}
                        {weekdeal.compareAtCents ? (
                          <span className="ml-1.5 text-dim line-through">
                            {formatEuro(weekdeal.compareAtCents)}
                          </span>
                        ) : null}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs font-semibold text-primary">
                      Bekijk deal →
                    </span>
                  </Link>

                  <Link
                    to="/product/$slug"
                    params={{ slug: weekdeal.slug }}
                    className="block overflow-hidden rounded-lg ring-1 ring-border"
                  >
                    <img
                      src={weekdeal.images[0]?.src}
                      alt={weekdeal.images[0]?.alt ?? weekdeal.name}
                      width={800}
                      height={800}
                      className="aspect-[4/3] w-full object-cover sm:aspect-[16/10]"
                    />
                  </Link>
                </>
              )}

              <div className="flex flex-col gap-2 sm:flex-row">
                {weekdeal && (
                  <Button
                    size="lg"
                      className="glow-primary w-full sm:flex-1"
                      asChild
                    >
                      <Link
                        to="/product/$slug"
                        params={{ slug: weekdeal.slug }}
                      >
                        Koop {weekdeal.name}
                        <ArrowRight className="size-4" />
                      </Link>
                  </Button>
                )}
                <Button
                  size="lg"
                  variant="secondary"
                  className="w-full sm:flex-1"
                  asChild
                >
                  <a href="#producten">Bekijk 6 producten</a>
                </Button>
              </div>
            </div>
          </div>

          <div className="order-2 relative min-w-0 hidden md:block">
            <div
              className="absolute inset-8 rounded-full bg-primary/8 blur-3xl pointer-events-none"
              aria-hidden
            />
            <Link
              to="/product/$slug"
              params={{ slug: featured.slug }}
              className="relative mx-auto block max-w-md md:max-w-none"
            >
              <img
                src={featured.images[0]?.src}
                alt={featured.images[0]?.alt ?? featured.name}
                width={800}
                height={800}
                fetchPriority="high"
                className="relative z-10 mx-auto w-full max-w-sm rounded-2xl object-cover shadow-lg shadow-fg/8 ring-1 ring-border md:max-w-md"
              />
              <div className="absolute bottom-4 left-4 right-4 z-20 rounded-xl border border-border bg-surface/95 px-4 py-3 shadow-md backdrop-blur-sm">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-primary">
                  Weekdeal
                </p>
                <p className="text-sm font-bold tracking-tight">
                  {featured.name}
                </p>
                <p className="text-sm font-extrabold tabular-nums text-fg">
                  {formatEuro(featured.priceCents)}
                </p>
              </div>
            </Link>
          </div>
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-dim sm:gap-x-5 sm:text-xs">
            <span className="inline-flex items-center gap-1">
              <Truck className="size-3.5 text-muted" aria-hidden /> 1 – 2
              werkdagen
            </span>
            <span className="text-border" aria-hidden>
              ·
            </span>
            <span className="inline-flex items-center gap-1">
              <Package className="size-3.5 text-muted" aria-hidden /> Discreet
              verzonden
            </span>
            <span className="text-border" aria-hidden>
              ·
            </span>
            <span className="inline-flex items-center gap-1">
              <ShieldCheck className="size-3.5 text-muted" aria-hidden />{" "}
              Labgetest
            </span>
          </div>
        </div>
      </section>

      <section
        id="producten"
        className="border-y border-border bg-bg-elevated scroll-mt-28"
      >
        <span id="semaglutide" className="sr-only">
          Semaglutide
        </span>
        <span id="tirzepatide" className="sr-only">
          Tirzepatide
        </span>
        <span id="retatrutide" className="sr-only">
          Retatrutide
        </span>
        <div className="container-max section-pad py-16 md:py-24">
          <div className="mb-8 flex flex-col gap-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary mb-3">
                  Assortiment
                </p>
                <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
                  {SITE.category}
                </h2>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <p className="text-muted">{visible.length} producten</p>
                  {filter !== "all" ? (
                    <button
                      type="button"
                      onClick={() => setFilterAndHash("all")}
                      className="inline-flex items-center rounded-full border border-primary/30 bg-primary/8 px-2.5 py-1 text-xs font-semibold text-primary transition hover:bg-primary/14"
                    >
                      Toon alle producten
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
            <div
              className="flex flex-nowrap gap-2 overflow-x-auto pb-0.5"
              role="group"
              aria-label="Filter op stof"
            >
              {catalogFilters.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={filter === s.id}
                  onClick={() => setFilterAndHash(s.id)}
                  className={cn(
                    "shrink-0 rounded-full border px-3 py-2 text-xs font-semibold transition sm:px-3.5 sm:text-sm",
                    filter === s.id
                      ? "border-primary bg-primary text-primary-fg"
                      : "border-border bg-surface text-muted hover:border-primary/40 hover:text-fg",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((p) => (
              <ProductCard key={p.slug} product={p} />
            ))}
          </div>
        </div>
      </section>

      <section
        id="voordelen"
        className="container-max section-pad py-16 md:py-24"
      >
        <div className="mx-auto max-w-2xl text-center mb-12">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary mb-3">
            Waarom deze lijn
          </p>
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
            Drie stoffen.
            <br />
            Zes mogelijkheden.
          </h2>
          <p className="mt-3 text-muted">
            Semaglutide, Tirzepatide en Retatrutide, elk verkrijgbaar als pen én
            vial.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {BENEFITS.map((b, i) => (
            <article
              key={b.title}
              className="surface-card group rounded-xl p-6 transition-all duration-200 hover:border-primary/30 hover:shadow-md"
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex size-11 items-center justify-center rounded-lg bg-primary text-primary-fg transition-colors sm:bg-primary/10 sm:text-primary sm:group-hover:bg-primary sm:group-hover:text-primary-fg">
                  <BenefitIcon name={b.icon} className="size-5" />
                </div>
                <span
                  className="text-xs font-bold tabular-nums text-primary"
                  aria-hidden
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
              </div>
              <h3 className="text-lg font-bold tracking-tight text-fg">
                {b.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                {b.description}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-b border-border bg-fg text-bg">
        <div className="container-max section-pad py-16 md:py-24">
          <div className="mx-auto max-w-2xl text-center mb-12">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary mb-3">
              Vial vs pen
            </p>
            <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl text-bg">
              Kies de vorm die bij je past
            </h2>
          </div>
          <div className="mx-auto grid max-w-4xl gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-primary/50 bg-gradient-to-b from-primary/25 to-primary/10 p-6 transition duration-200 hover:border-primary/70 hover:from-primary/30 hover:to-primary/15 active:border-primary/80 active:from-primary/35 active:to-primary/20">
              <p className="text-xs font-bold uppercase tracking-wider text-primary mb-4">
                Pen · pluspunten
              </p>
              <ul className="space-y-3">
                {FORM_COMPARE.pen.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-3 text-sm font-medium text-white"
                  >
                    <Check
                      className="size-4 shrink-0 text-success mt-0.5"
                      strokeWidth={2.75}
                    />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-primary/50 bg-gradient-to-b from-primary/25 to-primary/10 p-6 transition duration-200 hover:border-primary/70 hover:from-primary/30 hover:to-primary/15 active:border-primary/80 active:from-primary/35 active:to-primary/20">
              <p className="text-xs font-bold uppercase tracking-wider text-primary mb-4">
                Vial · pluspunten
              </p>
              <ul className="space-y-3">
                {FORM_COMPARE.vial.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-3 text-sm font-medium text-white"
                  >
                    <Check
                      className="size-4 shrink-0 text-success mt-0.5"
                      strokeWidth={2.75}
                    />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section id="formule" className="border-y border-border bg-bg-elevated">
        <div className="container-max section-pad py-16 md:py-24">
          <div className="mb-10">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary mb-3">
              Verschillende stoffen
            </p>
            <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
              Semaglutide
              <br />
              Tirzepatide
              <br />
              Retatrutide
            </h2>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {COMPOUNDS.map((c) => (
              <article
                key={c.name}
                className="rounded-xl border border-border bg-surface p-5"
              >
                <div className="flex items-center gap-2">
                  <FlaskConical className="size-4 text-primary" />
                  <h3 className="font-bold tracking-tight">{c.name}</h3>
                </div>
                <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-dim">
                  {c.role}
                </p>
                <p className="mt-2 text-sm leading-snug text-muted">
                  {c.detail}
                </p>
                <a
                  href={`/#${c.name.toLowerCase()}`}
                  className="mt-4 inline-flex text-sm font-semibold text-primary hover:underline"
                >
                  {c.count} producten →
                </a>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        id="beoordelingen"
        className="container-max section-pad py-16 md:py-24"
      >
        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary mb-3">
            Ervaringen
          </p>
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
            Wat klanten zeggen
          </h2>
        </div>
        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          <div className="flex items-center gap-4 rounded-xl border border-border bg-surface px-5 py-4 shadow-sm">
            <span className="text-4xl font-extrabold tracking-tight tabular-nums text-fg">
              {SITE.rating}
            </span>
            <div>
              <Stars rating={SITE.rating} />
              <p className="mt-1 text-xs text-muted">
                {SITE.reviewCount.toLocaleString("nl-NL")} beoordelingen
              </p>
            </div>
          </div>
          <div className="rounded-xl border border-border bg-surface px-5 py-4 shadow-sm space-y-1.5">
            {RATING_BREAKDOWN.map((row) => (
              <div key={row.stars} className="flex items-center gap-2 text-xs">
                <span className="w-3 tabular-nums text-muted font-medium">
                  {row.stars}
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
                  <div
                    className="h-full rounded-full bg-star"
                    style={{ width: `${row.pct}%` }}
                  />
                </div>
                <span className="w-8 text-right tabular-nums text-dim">
                  {row.pct}%
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {REVIEWS.map((r) => (
            <article
              key={r.name}
              className="flex flex-col rounded-xl border border-border bg-surface p-6 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold tracking-tight text-fg">
                    {r.name}
                  </p>
                  <p className="text-xs text-muted">{r.role}</p>
                </div>
                {r.verified && (
                  <span className="shrink-0 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-success">
                    Geverifieerd
                  </span>
                )}
              </div>
              <Stars rating={r.rating} size="sm" className="mt-3" />
              <h3 className="mt-3 text-base font-bold tracking-tight text-fg">
                “{r.title}”
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                {r.text}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section id="faq" className="container-max section-pad py-16 md:py-24">
        <div className="mx-auto max-w-2xl">
          <div className="text-center mb-10">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary mb-3">
              Hulp & info
            </p>
            <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
              Veelgestelde vragen
            </h2>
          </div>
          <div className="rounded-xl border border-border bg-surface px-5 sm:px-6 shadow-sm">
            <Accordion type="single" collapsible className="w-full">
              {FAQS.map((item, i) => (
                <AccordionItem key={item.q} value={`faq-${i}`}>
                  <AccordionTrigger>{item.q}</AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-3">
                      {item.body.map((block, bi) =>
                        block.type === "p" ? (
                          <p key={bi}>{block.text}</p>
                        ) : (
                          <ul key={bi} className="list-disc space-y-1.5 pl-5">
                            {block.items.map((li) => (
                              <li key={li}>{li}</li>
                            ))}
                          </ul>
                        ),
                      )}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
          <div className="mt-10 rounded-xl border border-primary/20 bg-primary/5 p-6 text-center">
            <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Rocket className="size-5" aria-hidden />
            </div>
            <h3 className="text-xl font-extrabold tracking-tight">
              Klaar om te kiezen?
            </h3>
            <p className="mt-2 text-sm text-muted">
              Gratis verzending vanaf €100.
            </p>
            <Button size="lg" className="mt-5 glow-primary" asChild>
              <a href="#producten">
                Naar de producten
                <ArrowRight className="size-4" />
              </a>
            </Button>
          </div>
        </div>
      </section>
    </SiteShell>
  );
}
