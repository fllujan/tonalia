import { create } from "zustand";

export type View = "library" | "review" | "settings" | "detail";

interface ViewState {
  view: View;
  /** Track shown in the detail view. */
  trackId: number | null;
  /** Where "Back" returns from the detail view. */
  back: Exclude<View, "detail">;
  show: (view: Exclude<View, "detail">) => void;
  openDetail: (trackId: number) => void;
  closeDetail: () => void;
}

export const useViewStore = create<ViewState>((set) => ({
  view: "library",
  trackId: null,
  back: "library",
  show: (view) => set({ view, trackId: null }),
  openDetail: (trackId) =>
    set((s) => ({ view: "detail", trackId, back: s.view === "detail" ? s.back : s.view })),
  closeDetail: () => set((s) => ({ view: s.back, trackId: null })),
}));
