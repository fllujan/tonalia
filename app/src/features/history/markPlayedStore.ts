// What "Mark as played" (SPEC 13.4) is about to mark: the dialog opens when it is set.
import { create } from "zustand";

export interface MarkTarget {
  trackIds?: number[];
  playlistId?: number;
  /** The session's name: the playlist or set it was. */
  name?: string;
  /** How many tracks, for the sentence. */
  count: number;
}

export const useMarkPlayed = create<{
  target: MarkTarget | null;
  open: (target: MarkTarget) => void;
  close: () => void;
}>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}));
