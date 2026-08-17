import { useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { cartCount, useCartStore } from "@/lib/cart-store";
import { getProduct, SITE } from "@/lib/product";

const BASE = "GLP-1 Afvallen | VOLT";

export function DocumentTitleBadge() {
  const lines = useCartStore((s) => s.lines);
  const count = cartCount(lines);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const product = pathname.startsWith("/product/")
    ? getProduct(pathname.split("/").filter(Boolean).at(-1))
    : undefined;
  const baseTitle = product
    ? `${product.name} kopen | ${SITE.brand}`
    : pathname.startsWith("/product/")
      ? `Product | ${SITE.brand}`
      : BASE;

  useEffect(() => {
    document.title = count > 0 ? `(${count}) ${baseTitle}` : baseTitle;
  }, [baseTitle, count]);

  return null;
}
