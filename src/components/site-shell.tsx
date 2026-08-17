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
      className="min-h-screen bg-bg text-fg pb-[calc(6rem+var(--volt-cookie-h,0px))] md:pb-[var(--volt-cookie-h,0px)]"
    >
      <DocumentTitleBadge />
      <SiteHeader />
      <CartDrawer />
      <ContactDialog />
      <MobileStickyBar />
      <Toasts />
      <BackToTop />
      <CookieBanner />
      {children}
      <SiteFooter />
    </div>
  );
}
