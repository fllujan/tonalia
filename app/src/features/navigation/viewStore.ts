import { create } from "zustand";

export type View = "library" | "review" | "settings";

interface ViewState {
  view: View;
  show: (view: View) => void;
}

export const useViewStore = create<ViewState>((set) => ({
  view: "library",
  show: (view) => set({ view }),
}));
