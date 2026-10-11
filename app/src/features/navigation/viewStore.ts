import { create } from "zustand";

export type View = "library" | "settings";

interface ViewState {
  view: View;
  show: (view: View) => void;
}

export const useViewStore = create<ViewState>((set) => ({
  view: "library",
  show: (view) => set({ view }),
}));
