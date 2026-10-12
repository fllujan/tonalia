import { create } from "zustand";
import { useDecksStore } from "../decks/decksStore";

export type View =
  | "library"
  | "review"
  | "settings"
  | "export"
  | "guides"
  | "playlist"
  | "detail"
  | "tags"
  | "pro"
  | "favorites"
  | "builder";
type Home =
  | "library"
  | "review"
  | "settings"
  | "export"
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
  show: (view: Exclude<Home, "playlist">) => void;
  openPlaylist: (playlistId: number) => void;
  openDetail: (trackId: number) => void;
  closeDetail: () => void;
  openTags: (trackIds: number[], scope?: TagScope) => void;
  openInfo: (trackId: number) => void;
  /** Pro mode with this track on deck A. */
  openPro: (trackId: number) => void;
  closeInfo: () => void;
}

const home = (s: ViewState): Home => (s.view === "detail" || s.view === "tags" ? s.back : s.view);

export const useViewStore = create<ViewState>((set) => ({
  view: "library",
  playlistId: null,
  trackId: null,
  tagTrackIds: [],
  tagScope: "view",
  infoTrackId: null,
  back: "library",
  show: (view) => set({ view, trackId: null }),
  openPlaylist: (playlistId) => set({ view: "playlist", playlistId, trackId: null }),
  openDetail: (trackId) => set((s) => ({ view: "detail", trackId, back: home(s) })),
  closeDetail: () => set((s) => ({ view: s.back, trackId: null })),
  openTags: (tagTrackIds, tagScope = "view") =>
    set((s) => ({ view: "tags", tagTrackIds, tagScope, back: home(s) })),
  openInfo: (infoTrackId) => set({ infoTrackId }),
  closeInfo: () => set({ infoTrackId: null }),
  openPro: (trackId) => {
    useDecksStore.getState().loadA(trackId);
    set({ view: "pro", trackId: null });
  },
}));
