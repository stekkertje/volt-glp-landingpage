import { useEffect, type ReactNode } from "react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { CartDrawer } from "@/components/cart-drawer";
import { MobileStickyBar } from "@/components/mobile-sticky-bar";
import { Toasts } from "@/components/toasts";
import { BackToTop } from "@/components/back-to-top";
import { CookieBanner } from "@/components/cookie-banner";
import { ContactDialog } from "@/components/contact-dialog";
import { DocumentTitleBadge } from "@/components/document-title-badge";
import { CartHydrate } from "@/components/cart-hydrate";
import { useContactStore } from "@/lib/contact-store";

export function SiteShell({ children }: { children: ReactNode }) {
  const openContact = useContactStore((state) => state.openContact);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("contact") !== "1") return;

    openContact();
    params.delete("contact");
    const query = params.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
  }, [openContact]);

  return (
    <div id="top" className="min-h-dvh bg-bg pb-24 text-fg md:pb-0">
      <CartHydrate />
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
