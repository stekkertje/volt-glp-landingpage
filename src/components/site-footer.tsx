import { useContactStore } from "@/lib/contact-store";
import { SITE } from "@/lib/product";

export function SiteFooter() {
  const openContact = useContactStore((s) => s.openContact);

  return (
    <footer className="border-t border-border bg-fg text-bg">
      <div className="container-max section-pad py-12">
        <div className="flex flex-col gap-8 sm:flex-row sm:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-fg text-xs font-extrabold">
                V
              </span>
              <span className="text-lg font-extrabold tracking-tight">
                {SITE.brand}
                <span className="text-primary">.</span>
              </span>
            </div>
            <p className="mt-3 max-w-xs text-sm text-bg/60">
              {SITE.category}. {SITE.tagline}.
            </p>
          </div>
          <div className="flex flex-col gap-8 text-sm sm:min-w-[18rem]">
            <div>
              <p className="font-semibold tracking-tight text-bg mb-3">Product</p>
              <ul className="space-y-2 text-bg/60">
                <li>
                  <a href="/#producten" className="hover:text-bg">
                    Alle producten
                  </a>
                </li>
                <li>
                  <a href="/#semaglutide" className="hover:text-bg">
                    Semaglutide
                  </a>
                </li>
                <li>
                  <a href="/#tirzepatide" className="hover:text-bg">
                    Tirzepatide
                  </a>
                </li>
                <li>
                  <a href="/#retatrutide" className="hover:text-bg">
                    Retatrutide
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <p className="font-semibold tracking-tight text-bg mb-3">Levering</p>
              <ul className="space-y-2 text-bg/60">
                <li>Nederland & België</li>
                <li>1–2 werkdagen</li>
                <li className="whitespace-nowrap">Gratis levering vanaf €100</li>
              </ul>
            </div>
            <div>
              <p className="font-semibold tracking-tight text-bg mb-3">Service</p>
              <ul className="space-y-2 text-bg/60">
                <li>
                  <a href="/#faq" className="hover:text-bg">
                    Veelgestelde vragen
                  </a>
                </li>
                <li>
                  <a href="/#beoordelingen" className="hover:text-bg">
                    Beoordelingen
                  </a>
                </li>
                <li>
                  <button type="button" onClick={openContact} className="hover:text-bg text-left">
                    Contact
                  </button>
                </li>
                <li>
                  <a
                    href="mailto:support@voltperformance.nl"
                    className="text-bg/60 hover:text-bg"
                  >
                    support@voltperformance.nl
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>
        <div className="mt-10 border-t border-white/10 pt-6 text-xs text-bg/40 space-y-1">
          <p>© {new Date().getFullYear()} VOLT Performance. Alle rechten voorbehouden.</p>
          <p>Projectpreview · winkelwagen, contact en checkout zijn demo.</p>
        </div>
      </div>
    </footer>
  );
}
