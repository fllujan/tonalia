import { create } from "zustand";

export type View = "library" | "review" | "settings" | "detail" | "tags";
type Home = "library" | "review" | "settings";

interface ViewState {
  view: View;
  /** Track shown in the detail view. */
  trackId: number | null;
  /** Tracks the tags screen works on. */
  tagTrackIds: number[];
  /** Where "Back" returns from the detail and tags views. */
  back: Home;
  show: (view: Home) => void;
  openDetail: (trackId: number) => void;
  closeDetail: () => void;
  openTags: (trackIds: number[]) => void;
}

const home = (s: ViewState): Home => (s.view === "detail" || s.view === "tags" ? s.back : s.view);

export const useViewStore = create<ViewState>((set) => ({
  view: "library",
  trackId: null,
  tagTrackIds: [],
  back: "library",
  show: (view) => set({ view, trackId: null }),
  openDetail: (trackId) => set((s) => ({ view: "detail", trackId, back: home(s) })),
  closeDetail: () => set((s) => ({ view: s.back, trackId: null })),
  openTags: (tagTrackIds) => set((s) => ({ view: "tags", tagTrackIds, back: home(s) })),
}));
