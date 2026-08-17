import { ShoppingBag, Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useCartStore, cartCount, useHasCartHydrated } from "@/lib/cart-store";
import { useContactStore } from "@/lib/contact-store";
import { cn } from "@/lib/utils";
import { AnnounceBar } from "@/components/announce-bar";

const LINKS = [
  { href: "/#producten", label: "Producten" },
  { href: "/#semaglutide", label: "Semaglutide" },
  { href: "/#tirzepatide", label: "Tirzepatide" },
  { href: "/#retatrutide", label: "Retatrutide" },
  { href: "/#faq", label: "Veelgestelde vragen" },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [headerH, setHeaderH] = useState(108);
  const lines = useCartStore((s) => s.lines);
  const hydrated = useHasCartHydrated();
  const count = hydrated ? cartCount(lines) : 0;
  const openCart = useCartStore((s) => s.openCart);
  const openContact = useContactStore((s) => s.openContact);

  const chromeRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const lastY = useRef(0);
  const hiddenRef = useRef(false);
  const openRef = useRef(false);
  const ignoreScrollUntil = useRef(0);
  const idleTimer = useRef<number | null>(null);
  const ticking = useRef(false);

  openRef.current = open;
  hiddenRef.current = hidden;

  const setMenuOpen = (next: boolean | ((v: boolean) => boolean)) => {
    setOpen((prev) => {
      const value = typeof next === "function" ? next(prev) : next;
      if (value) {
        // Ignore layout-shift scroll right after open
        ignoreScrollUntil.current = Date.now() + 500;
        lastY.current = window.scrollY || document.documentElement.scrollTop || 0;
      }
      return value;
    });
  };

  // Measure only bar + marquee (not open mobile panel) so opening menu
  // does not push the page and fire a scroll that auto-closes the menu.
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const measure = () => setHeaderH(el.offsetHeight || 108);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
    document.addEventListener("keydown", onKey);
    // bubble phase so the hamburger toggle click finishes first
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  useEffect(() => {
    lastY.current = window.scrollY || document.documentElement.scrollTop || 0;

    const setHiddenSafe = (next: boolean) => {
      if (hiddenRef.current === next) return;
      hiddenRef.current = next;
      setHidden(next);
    };

    const scheduleShow = () => {
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(() => setHiddenSafe(false), 280);
    };

    const applyScroll = () => {
      ticking.current = false;
      const y = window.scrollY || document.documentElement.scrollTop || 0;
      const delta = y - lastY.current;

      if (openRef.current) {
        // Ignore scroll jank right after open / tiny shifts
        if (Date.now() < ignoreScrollUntil.current || Math.abs(delta) < 24) {
          lastY.current = y;
          return;
        }
        // Real user scroll while menu open → close
        setMenuOpen(false);
        setHiddenSafe(false);
        lastY.current = y;
        return;
      }

      if (y < 16) {
        setHiddenSafe(false);
        lastY.current = y;
        scheduleShow();
        return;
      }

      if (Math.abs(delta) < 4) {
        scheduleShow();
        return;
      }

      if (delta > 0) {
        setHiddenSafe(true);
      } else {
        setHiddenSafe(false);
      }

      lastY.current = y;
      scheduleShow();
    };

    const onScroll = () => {
      if (!ticking.current) {
        ticking.current = true;
        window.requestAnimationFrame(applyScroll);
      }
    };

    let touchStartY = 0;
    const onTouchStart = (e: TouchEvent) => {
      touchStartY = e.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (openRef.current) return;
      const y = e.touches[0]?.clientY ?? 0;
      const dy = y - touchStartY;
      if (Math.abs(dy) < 10) return;
      if (dy < 0) setHiddenSafe(true);
      else setHiddenSafe(false);
      touchStartY = y;
      scheduleShow();
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
    };
  }, []);

  return (
    <>
      <div style={{ height: headerH }} aria-hidden className="shrink-0" />

      <div
        ref={chromeRef}
        className={cn(
          "fixed left-0 right-0 top-0 z-50 transition-transform duration-300 ease-out will-change-transform",
          hidden && !open ? "-translate-y-full pointer-events-none" : "translate-y-0",
        )}
      >
        <div ref={barRef}>
          <AnnounceBar />

          <header className="relative border-b border-border bg-bg/95 backdrop-blur-xl">
            <div className="container-max section-pad flex h-16 items-center justify-between gap-4 md:h-[4.25rem]">
              <a
                href="/#top"
                className="flex items-center gap-2.5 shrink-0"
                onClick={() => setMenuOpen(false)}
              >
                <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-fg text-sm font-extrabold tracking-tight">
                  V
                </span>
                <span className="text-lg font-extrabold tracking-tight text-fg">
                  VOLT<span className="text-primary">.</span>
                </span>
              </a>

              <nav className="hidden items-center gap-0.5 lg:flex" aria-label="Hoofdmenu">
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
                open ? "max-h-[28rem] opacity-100" : "max-h-0 opacity-0 border-b-0 shadow-none",
              )}
              hidden={!open}
              inert={!open ? true : undefined}
            >
              <nav className="section-pad flex flex-col gap-1 py-3" aria-label="Mobiel menu">
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
                <button
                  type="button"
                  tabIndex={open ? 0 : -1}
                  onClick={() => {
                    setMenuOpen(false);
                    openContact();
                  }}
                  className="rounded-lg px-3 py-3 text-left text-sm font-medium text-fg hover:bg-bg-elevated"
                >
                  Contact
                </button>
                <Button asChild className="mt-2 w-full">
                  <a href="/#producten" onClick={() => setMenuOpen(false)} tabIndex={open ? 0 : -1}>
                    Nu kopen
                  </a>
                </Button>
              </nav>
            </div>
          </header>
        </div>
      </div>
    </>
  );
}
