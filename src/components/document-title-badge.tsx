import { useEffect } from "react";
import { cartCount, useCartStore } from "@/lib/cart-store";

const BASE = "GLP-1 Afvallen | VOLT";

export function DocumentTitleBadge() {
  const lines = useCartStore((s) => s.lines);
  const count = cartCount(lines);

  useEffect(() => {
    document.title = count > 0 ? `(${count}) ${BASE}` : BASE;
  }, [count]);

  return null;
}
