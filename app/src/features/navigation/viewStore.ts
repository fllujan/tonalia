import { create } from "zustand";
import { useDecksStore } from "../decks/decksStore";
import type { Guide } from "../guides/guides";

export type View =
  | "library"
  | "review"
  | "duplicates"
  | "queue"
  | "settings"
  | "export"
  | "import"
  | "guides"
  | "playlist"
  | "detail"
  | "tags"
  | "pro"
  | "favorites"
  | "builder"
  | "energy"
  | "cueReview";
type Home =
  | "library"
  | "review"
  | "duplicates"
  | "queue"
  | "settings"
  | "export"
  | "import"
  | "guides"
  | "playlist"
  | "pro"
  | "favorites"
  | "builder";

export type TagScope = "selection" | "view";

interface ViewState {
  view: View;
  /** Playlist shown in the "playlist" view (and returned to from detail/tags). */
  playlistId: number | null;
  /** Track shown in the detail view. */
  trackId: number | null;
  /** Tracks the tags screen works on, and whether they are the selection or the whole view. */
  tagTrackIds: number[];
  tagScope: TagScope;
  /** Track open in the "Track info" panel (over any view). */
  infoTrackId: number | null;
  /** Where "Back" returns from the detail and tags views. */
  back: Home;
  /** The article open in the Guides. */
  guide: Guide;
  show: (view: Exclude<Home, "playlist">) => void;
  openPlaylist: (playlistId: number) => void;
  openDetail: (trackId: number) => void;
  closeDetail: () => void;
  openTags: (trackIds: number[], scope?: TagScope) => void;
  openInfo: (trackId: number) => void;
  /** Pro mode with this track on deck A. */
  openPro: (trackId: number) => void;
  closeInfo: () => void;
  /** The Guides, at this article. */
  openGuide: (guide: Guide) => void;
  /** "Calibrar energía"; Back returns where it was opened. */
  openEnergy: () => void;
  /** "Revisar cues" (SPEC 12.5): these tracks, or a queue of tracks to review when null. */
  reviewTrackIds: number[] | null;
  /** The detail it was opened from (Back returns to that track). */
  reviewFrom: number | null;
  openCueReview: (trackIds: number[] | null) => void;
  closeCueReview: () => void;
}

const home = (s: ViewState): Home =>
  s.view === "detail" || s.view === "tags" || s.view === "energy" || s.view === "cueReview"
    ? s.back
    : s.view;

export const useViewStore = create<ViewState>((set) => ({
  view: "library",
  playlistId: null,
  trackId: null,
  tagTrackIds: [],
  tagScope: "view",
  infoTrackId: null,
  back: "library",
  guide: "harmonic",
  show: (view) => set({ view, trackId: null }),
  openPlaylist: (playlistId) => set({ view: "playlist", playlistId, trackId: null }),
  openDetail: (trackId) => set((s) => ({ view: "detail", trackId, back: home(s) })),
  closeDetail: () => set((s) => ({ view: s.back, trackId: null })),
  openTags: (tagTrackIds, tagScope = "view") =>
    set((s) => ({ view: "tags", tagTrackIds, tagScope, back: home(s) })),
  openInfo: (infoTrackId) => set({ infoTrackId }),
  closeInfo: () => set({ infoTrackId: null }),
  openGuide: (guide) => set({ view: "guides", guide, trackId: null }),
  openEnergy: () => set((s) => ({ view: "energy", trackId: null, back: home(s) })),
  reviewTrackIds: null,
  reviewFrom: null,
  openCueReview: (reviewTrackIds) =>
    set((s) => ({
      view: "cueReview",
      reviewTrackIds,
      reviewFrom: s.view === "detail" ? s.trackId : null,
      trackId: null,
      back: home(s),
    })),
  closeCueReview: () =>
    set((s) =>
      s.reviewFrom != null
        ? { view: "detail", trackId: s.reviewFrom, reviewFrom: null, reviewTrackIds: null }
        : { view: s.back, trackId: null, reviewFrom: null, reviewTrackIds: null },
    ),
  openPro: (trackId) => {
    useDecksStore.getState().loadA(trackId);
    set({ view: "pro", trackId: null });
  },
}));
