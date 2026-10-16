// Every keyboard shortcut, as shown in the "Keyboard shortcuts" dialog (SPEC 2.14, 10.1).
import { create } from "zustand";
import { MOD } from "../../lib/keyboard";

export interface Shortcut {
  /** Key labels; "@name" is translated (`shortcuts.keys.name`). */
  keys: string[];
  /** i18n key under `shortcuts.actions`. */
  action: string;
}

export const SHORTCUT_GROUPS: readonly { group: string; items: Shortcut[] }[] = [
  {
    group: "general",
    items: [
      { keys: [MOD, "1"], action: "library" },
      { keys: [MOD, "2"], action: "pro" },
      { keys: [MOD, "3"], action: "favorites" },
      { keys: [MOD, "4"], action: "builder" },
      { keys: [MOD, ","], action: "settings" },
      { keys: [MOD, "F"], action: "search" },
      { keys: ["?"], action: "help" },
      { keys: ["Esc"], action: "close" },
    ],
  },
  {
    group: "library",
    items: [
      { keys: ["↑", "↓"], action: "move" },
      { keys: ["⇧", "↑ ↓"], action: "extend" },
      { keys: ["@home", "@end"], action: "ends" },
      { keys: ["↵"], action: "open" },
      { keys: ["@space"], action: "playPause" },
      { keys: ["Esc"], action: "deselect" },
    ],
  },
  {
    group: "detail",
    items: [
      { keys: ["@space"], action: "playPause" },
      { keys: ["1–8"], action: "cue" },
      { keys: ["Esc"], action: "back" },
    ],
  },
  {
    group: "grid",
    items: [
      { keys: [",", "."], action: "gridNudge" },
      { keys: ["⇧", ", ."], action: "gridNudge10" },
      { keys: ["D"], action: "gridDownbeat" },
      { keys: ["A"], action: "gridAnchor" },
      { keys: ["⌫"], action: "gridRemoveAnchor" },
      { keys: ["T"], action: "gridTap" },
      { keys: ["M"], action: "gridMetronome" },
      { keys: [MOD, "Z"], action: "gridUndo" },
      { keys: ["⇧", MOD, "Z"], action: "gridRedo" },
      { keys: ["Esc"], action: "gridClose" },
    ],
  },
  {
    group: "pro",
    items: [
      { keys: ["@space"], action: "tryStop" },
      { keys: ["←", "→"], action: "ideas" },
      { keys: ["Q", "W"], action: "pitchA" },
      { keys: ["O", "P"], action: "pitchB" },
      { keys: ["E"], action: "loopA" },
      { keys: ["I"], action: "loopB" },
      { keys: ["⇧", "← →"], action: "crossfader" },
      { keys: ["M"], action: "moveBToA" },
    ],
  },
  {
    group: "piano",
    items: [
      { keys: ["A", "W", "S", "E", "D…"], action: "notes" },
      { keys: ["Z", "X"], action: "octave" },
    ],
  },
];

export const useShortcutsDialog = create<{ open: boolean; setOpen: (open: boolean) => void }>(
  (set) => ({ open: false, setOpen: (open) => set({ open }) }),
);
