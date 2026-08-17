import { create } from "zustand";
import type { Subcat } from "@/lib/product";

export type CatalogFilter = Subcat | "all";

type CatalogFilterState = {
  filter: CatalogFilter;
  setFilter: (filter: CatalogFilter) => void;
};

export const useCatalogFilter = create<CatalogFilterState>((set) => ({
  filter: "all",
  setFilter: (filter) => set({ filter }),
}));
