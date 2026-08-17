import { create } from "zustand";

type ContactState = {
  open: boolean;
  openContact: () => void;
  closeContact: () => void;
};

export const useContactStore = create<ContactState>((set) => ({
  open: false,
  openContact: () => set({ open: true }),
  closeContact: () => set({ open: false }),
}));
