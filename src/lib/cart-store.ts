import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DEFAULT_PRODUCT_SLUG,
  PRODUCTS,
  SITE,
  getDefaultOptionId,
  getOption,
  getProduct,
  unitPriceCents,
  type ProductSlug,
} from "@/lib/product";

export const FREE_SHIPPING_CENTS = SITE.freeShippingCents;
export const MAX_LINE_QTY = 10;

export type CartLine = {
  slug: ProductSlug;
  optionId: string;
  qty: number;
};

export type ToastKind = "success" | "error";

type Toast = {
  id: number;
  message: string;
  detail?: string;
  kind: ToastKind;
};

type CartState = {
  selectedSlug: ProductSlug;
  selectedOptionId: string;
  selectedQty: number;
  cartOpen: boolean;
  lines: CartLine[];
  discountCode: string;
  discountApplied: boolean;
  toasts: Toast[];
  setSelected: (slug: ProductSlug, optionId?: string) => void;
  setSelectedOption: (optionId: string) => void;
  setSelectedQty: (qty: number) => void;
  addToCart: (slug?: ProductSlug, optionId?: string, qty?: number) => void;
  setLineQty: (slug: ProductSlug, optionId: string, qty: number) => void;
  removeLine: (slug: ProductSlug, optionId: string) => void;
  openCart: () => void;
  closeCart: () => void;
  clearCart: () => void;
  setDiscountCode: (code: string) => void;
  applyDiscount: () => boolean;
  pushToast: (message: string, detail?: string, kind?: ToastKind) => void;
  dismissToast: (id: number) => void;
};

let toastSeq = 0;

function lineKey(slug: string, optionId: string) {
  return `${slug}::${optionId}`;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      selectedSlug: DEFAULT_PRODUCT_SLUG,
      selectedOptionId: getDefaultOptionId(
        PRODUCTS.find((p) => p.slug === DEFAULT_PRODUCT_SLUG)!,
      ),
      selectedQty: 1,
      cartOpen: false,
      lines: [],
      discountCode: "",
      discountApplied: false,
      toasts: [],
      setSelected: (slug, optionId) => {
        const product = getProduct(slug);
        if (!product) return;
        set((s) => ({
          selectedSlug: slug,
          selectedOptionId: optionId ?? getDefaultOptionId(product),
          selectedQty: s.selectedSlug === slug ? s.selectedQty : 1,
        }));
      },
      setSelectedOption: (optionId) => set({ selectedOptionId: optionId }),
      setSelectedQty: (qty) =>
        set({ selectedQty: Math.min(MAX_LINE_QTY, Math.max(1, qty)) }),
      addToCart: (slug, optionId, qty) => {
        const product = getProduct(slug ?? get().selectedSlug);
        if (!product) return;
        const opt =
          optionId ?? get().selectedOptionId ?? getDefaultOptionId(product);
        const addQty = qty ?? get().selectedQty ?? 1;
        set((s) => {
          const existing = s.lines.find(
            (l) => lineKey(l.slug, l.optionId) === lineKey(product.slug, opt),
          );
          const nextQty = Math.min(
            MAX_LINE_QTY,
            (existing?.qty ?? 0) + addQty,
          );
          const lines = existing
            ? s.lines.map((l) =>
                lineKey(l.slug, l.optionId) === lineKey(product.slug, opt)
                  ? { ...l, qty: nextQty }
                  : l,
              )
            : [...s.lines, { slug: product.slug, optionId: opt, qty: nextQty }];
          return {
            lines,
            cartOpen: true,
            selectedSlug: product.slug,
            selectedOptionId: opt,
          };
        });
      },
      setLineQty: (slug, optionId, qty) => {
        set((s) => {
          if (qty <= 0) {
            return {
              lines: s.lines.filter(
                (l) => !(l.slug === slug && l.optionId === optionId),
              ),
            };
          }
          return {
            lines: s.lines.map((l) =>
              l.slug === slug && l.optionId === optionId
                ? { ...l, qty: Math.min(MAX_LINE_QTY, Math.max(1, qty)) }
                : l,
            ),
          };
        });
      },
      removeLine: (slug, optionId) =>
        set((s) => ({
          lines: s.lines.filter(
            (l) => !(l.slug === slug && l.optionId === optionId),
          ),
        })),
      openCart: () => set({ cartOpen: true }),
      closeCart: () => set({ cartOpen: false }),
      clearCart: () =>
        set({ lines: [], cartOpen: false, discountApplied: false }),
      setDiscountCode: (code) => set({ discountCode: code }),
      applyDiscount: () => {
        const code = get().discountCode.trim().toUpperCase();
        if (code === "VOLT10") {
          set({ discountApplied: true });
          get().pushToast(
            "Kortingscode toegepast",
            "10% extra op je subtotaal",
          );
          return true;
        }
        const alreadyApplied = get().discountApplied;
        if (alreadyApplied) set({ discountCode: "VOLT10" });
        get().pushToast(
          "Code niet geldig",
          alreadyApplied
            ? "Je actieve VOLT10-korting blijft staan"
            : "Probeer VOLT10 voor 10% korting",
          "error",
        );
        return false;
      },
      pushToast: (message, detail, kind = "success") => {
        const id = ++toastSeq;
        set((s) => ({ toasts: [...s.toasts, { id, message, detail, kind }] }));
        window.setTimeout(() => get().dismissToast(id), 3800);
      },
      dismissToast: (id) =>
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    }),
    {
      name: "volt-cart",
      skipHydration: true,
      partialize: (s) => ({
        lines: s.lines,
        discountCode: s.discountCode,
        discountApplied: s.discountApplied,
        selectedSlug: s.selectedSlug,
        selectedOptionId: s.selectedOptionId,
      }),
    },
  ),
);

export function cartCount(lines: CartLine[]) {
  return lines.reduce((n, l) => n + l.qty, 0);
}

export function cartSubtotalCents(lines: CartLine[]) {
  return lines.reduce((sum, l) => {
    const product = getProduct(l.slug);
    if (!product) return sum;
    return sum + unitPriceCents(product, l.optionId) * l.qty;
  }, 0);
}

export function stackDiscountPct(qty: number) {
  if (qty >= 10) return 20;
  if (qty >= 5) return 10;
  return 0;
}

export function cartStackDiscountCents(subtotal: number, qty: number) {
  const pct = stackDiscountPct(qty);
  if (!pct) return 0;
  return Math.round(subtotal * (pct / 100));
}

export function cartCodeDiscountCents(
  subtotalAfterStack: number,
  applied: boolean,
) {
  if (!applied) return 0;
  return Math.round(subtotalAfterStack * 0.1);
}

export function cartShippingCents(subtotalAfterDiscount: number) {
  return subtotalAfterDiscount >= FREE_SHIPPING_CENTS ? 0 : 495;
}

export function lineLabel(line: CartLine) {
  const product = getProduct(line.slug);
  if (!product) return "";
  const option = getOption(product, line.optionId);
  return option ? option.label : product.unit;
}
