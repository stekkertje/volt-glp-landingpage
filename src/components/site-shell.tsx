import type { ReactNode } from "react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { CartDrawer } from "@/components/cart-drawer";
import { MobileStickyBar } from "@/components/mobile-sticky-bar";
import { Toasts } from "@/components/toasts";
import { BackToTop } from "@/components/back-to-top";
import { CookieBanner } from "@/components/cookie-banner";
import { ContactDialog } from "@/components/contact-dialog";
import { DocumentTitleBadge } from "@/components/document-title-badge";

export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <div
      id="top"
      className="min-h-screen bg-bg text-fg pb-[calc(5.75rem+var(--volt-cookie-h,0px))] md:pb-0"
    >
      <a
        href="#inhoud"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[90] focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-fg"
      >
        Ga naar inhoud
      </a>
      <DocumentTitleBadge />
      <SiteHeader />
      <CartDrawer />
      <ContactDialog />
      <MobileStickyBar />
      <Toasts />
      <BackToTop />
      <CookieBanner />
      <main id="inhoud">{children}</main>
      <SiteFooter />
    </div>
  );
}
