import { create } from "zustand";

type SearchDialogState = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

/** Palette open state is global client UI state: the Ctrl/Cmd+K listener,
 * the sidebar entry, and the dialog itself all drive the one dialog mounted
 * in AppShell. Session-only — a reload starts closed. */
export const useSearchDialogStore = create<SearchDialogState>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
