import { ShoppingBag, Menu, UserRound, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useCartStore, cartCount } from "@/lib/cart-store";
import { cn } from "@/lib/utils";
import { AnnounceBar } from "@/components/announce-bar";
import { SITE } from "@/lib/product";

const LINKS = [
  { href: "/#semaglutide", label: "Semaglutide" },
  { href: "/#tirzepatide", label: "Tirzepatide" },
  { href: "/#retatrutide", label: "Retatrutide" },
  { href: "/#faq", label: "Veelgestelde vragen" },
  { href: "/#beoordelingen", label: "Reviews" },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const lines = useCartStore((s) => s.lines);
  const count = cartCount(lines);
  const openCart = useCartStore((s) => s.openCart);

  const chromeRef = useRef<HTMLElement | null>(null);

  const setMenuOpen = (next: boolean | ((v: boolean) => boolean)) => {
    setOpen(next);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    const onPointerDown = (e: PointerEvent) => {
      const root = chromeRef.current;
      if (!root) return;
      if (root.contains(e.target as Node)) return;
      setMenuOpen(false);
    };
    const onScroll = () => setMenuOpen(false);
    document.addEventListener("keydown", onKey);
    // bubble phase so the hamburger toggle click finishes first
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onScroll);
    };
  }, [open]);

  return (
    <>
      <AnnounceBar />
      <header
        ref={chromeRef}
        className="sticky top-0 z-50 border-b border-border bg-bg/95 backdrop-blur-xl"
      >
        <div className="relative">
          <div className="container-max section-pad flex h-16 items-center justify-between gap-4 md:h-[4.25rem]">
            <a
              href="/#top"
              className="flex items-center gap-2.5 shrink-0"
              onClick={() => setMenuOpen(false)}
            >
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-fg text-xs font-extrabold tracking-tight sm:size-9 sm:text-sm">
                A
              </span>
              <span className="max-w-[11.5rem] truncate text-[13px] font-extrabold tracking-tight text-fg sm:max-w-none sm:text-base lg:text-lg">
                {SITE.brand}
              </span>
            </a>

            <nav
              className="hidden items-center gap-0.5 lg:flex"
              aria-label="Hoofdmenu"
            >
              {LINKS.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  className="rounded-full px-3.5 py-2 text-sm font-medium text-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  {l.label}
                </a>
              ))}
            </nav>

            <div className="flex items-center gap-2">
              <a
                href="/account"
                onClick={() => setMenuOpen(false)}
                className="flex size-11 items-center justify-center rounded-full border border-border bg-surface text-fg transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                aria-label="Mijn account"
              >
                <UserRound className="size-5" aria-hidden />
              </a>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  openCart();
                }}
                className="relative flex size-11 items-center justify-center rounded-full border border-border bg-surface text-fg transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
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
              <Button asChild size="sm" className="hidden sm:inline-flex">
                <a href="/#producten">Nu kopen</a>
              </Button>
              <button
                type="button"
                className="flex size-11 items-center justify-center rounded-full border border-border bg-surface text-fg lg:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                onClick={() => setMenuOpen((v) => !v)}
                aria-label={open ? "Menu sluiten" : "Menu openen"}
                aria-expanded={open}
                aria-controls="mobile-nav"
              >
                {open ? <X className="size-5" /> : <Menu className="size-5" />}
              </button>
            </div>
          </div>

          {/* Overlay panel: does not change page spacer height */}
          <div
            id="mobile-nav"
            className={cn(
              "absolute left-0 right-0 top-full z-50 border-b border-border bg-surface shadow-lg lg:hidden overflow-hidden transition-all duration-200",
              open
                ? "max-h-[28rem] opacity-100"
                : "max-h-0 opacity-0 border-b-0 shadow-none",
            )}
            hidden={!open}
            inert={!open ? true : undefined}
          >
            <nav
              className="section-pad flex flex-col gap-1 py-3"
              aria-label="Mobiel menu"
            >
              {LINKS.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  onClick={() => setMenuOpen(false)}
                  tabIndex={open ? 0 : -1}
                  className="rounded-lg px-3 py-3 text-sm font-medium text-fg hover:bg-bg-elevated"
                >
                  {l.label}
                </a>
              ))}
              <Button asChild className="mt-2 w-full">
                <a
                  href="/#producten"
                  onClick={() => setMenuOpen(false)}
                  tabIndex={open ? 0 : -1}
                >
                  Nu kopen
                </a>
              </Button>
            </nav>
          </div>
        </div>
      </header>
    </>
  );
}
