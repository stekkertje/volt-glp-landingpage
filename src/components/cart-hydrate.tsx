import { useEffect } from "react";
import { useCartStore } from "@/lib/cart-store";

export function CartHydrate() {
  useEffect(() => {
    void useCartStore.persist.rehydrate();
  }, []);

  return null;
}
