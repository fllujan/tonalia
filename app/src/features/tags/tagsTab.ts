import { create } from "zustand";

export const TAGS_TABS = ["write", "clean", "edit", "history"] as const;
export type TagsTab = (typeof TAGS_TABS)[number];

/** The open tab of the tags screen, so the preview footer can point to the history. */
export const useTagsTab = create<{ tab: TagsTab; setTab: (tab: TagsTab) => void }>((set) => ({
  tab: "write",
  setTab: (tab) => set({ tab }),
}));
