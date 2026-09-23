import { useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { cartCount, useCartStore } from "@/lib/cart-store";
import { getProduct, SITE } from "@/lib/product";
import { HOME_SEO_TITLE } from "@/lib/seo";

function stripCartCount(title: string) {
  return title.replace(/^\(\d+\)\s+/, "");
}

function titleForPath(pathname: string, current: string) {
  if (pathname === "/" || pathname === "") return HOME_SEO_TITLE;
  const product = pathname.startsWith("/product/")
    ? getProduct(pathname.split("/").filter(Boolean).at(-1))
    : undefined;
  if (product) {
    return product.seoTitle ?? `${product.name} kopen | ${SITE.brand}`;
  }
  if (pathname.startsWith("/product/")) return `Product | ${SITE.brand}`;
  if (pathname === "/checkout") return `Afrekenen | ${SITE.brand}`;
  if (pathname === "/account") return `Mijn account | ${SITE.brand}`;
  if (pathname.startsWith("/bestelling/")) return `Bestelling | ${SITE.brand}`;
  return stripCartCount(current) || SITE.brand;
}

export function DocumentTitleBadge() {
  const lines = useCartStore((s) => s.lines);
  const count = cartCount(lines);
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  useEffect(() => {
    const next = titleForPath(pathname, document.title);
    document.title = count > 0 ? `(${count}) ${stripCartCount(next)}` : next;
  }, [pathname, count]);

  return null;
}
