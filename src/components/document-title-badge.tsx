import { useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { cartCount, useCartStore } from "@/lib/cart-store";
import { getProduct, SITE } from "@/lib/product";

const HOME_TITLE = `${SITE.category} | ${SITE.brand}`;

export function DocumentTitleBadge() {
  const lines = useCartStore((s) => s.lines);
  const count = cartCount(lines);
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const productSlug = pathname.startsWith("/product/")
    ? pathname.slice("/product/".length).split("/")[0]
    : undefined;
  const product = getProduct(productSlug);
  const routeTitle = product
    ? `${product.name} kopen | ${SITE.brand}`
    : HOME_TITLE;

  useEffect(() => {
    document.title = count > 0 ? `(${count}) ${routeTitle}` : routeTitle;
  }, [count, routeTitle]);

  return null;
}
