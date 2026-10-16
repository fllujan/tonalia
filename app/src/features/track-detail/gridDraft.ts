// The grid editor's draft, kept in the detail view: while the editor is open the detail
// waveform, its ruler and cue snapping follow the grid being edited (SPEC 12.4).
import { useCallback, useMemo, useState } from "react";
import type { BeatGrid } from "../../lib/beats";
import { type EditorGrid, editorFromStored } from "../../lib/gridEdit";

export interface History {
  past: EditorGrid[];
  present: EditorGrid;
  future: EditorGrid[];
}

export function sameGrid(a: EditorGrid, b: EditorGrid): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Keep the editor's draft grid in its parent: the detail waveform and ruler follow it. */
export function useGridDraft(stored: BeatGrid | null) {
  const initial = useMemo(() => editorFromStored(stored), [stored]);
  const [history, setHistory] = useState<History | null>(null);
  const start = useCallback(() => {
    if (initial) setHistory({ past: [], present: initial, future: [] });
  }, [initial]);
  const stop = useCallback(() => setHistory(null), []);
  return { initial, history, setHistory, start, stop };
}
