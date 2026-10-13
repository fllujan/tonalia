// The part of a tag value that changed (DESIGN 5.16: "the difference highlighted"):
// what `after` keeps from the start and end of `before`, and the new middle. Works on
// code points so an emoji is never split. A cleaned value that is just a piece of the old
// one (a pure deletion) highlights nothing new; the old value marks what went instead.
export interface ChangedSpan {
  prefix: string;
  changed: string;
  suffix: string;
}

/** How many code points `before` and `after` share at the start and at the end. */
function shared(a: string[], b: string[]): { start: number; end: number } {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  )
    end++;
  return { start, end };
}

export function changedSpan(before: string, after: string): ChangedSpan {
  if (after && after !== before && before.includes(after)) {
    return { prefix: after, changed: "", suffix: "" };
  }
  const a = Array.from(before);
  const b = Array.from(after);
  const { start, end } = shared(a, b);
  return {
    prefix: b.slice(0, start).join(""),
    changed: b.slice(start, b.length - end).join(""),
    suffix: b.slice(b.length - end).join(""),
  };
}

export interface Part {
  text: string;
  removed: boolean;
}

/** The old value split into what the new one keeps and what it drops. */
export function removedParts(before: string, after: string): Part[] {
  let parts: Part[];
  const at = after ? before.indexOf(after) : -1;
  if (at >= 0) {
    parts = [
      { text: before.slice(0, at), removed: true },
      { text: after, removed: false },
      { text: before.slice(at + after.length), removed: true },
    ];
  } else {
    const a = Array.from(before);
    const { start, end } = shared(a, Array.from(after));
    parts = [
      { text: a.slice(0, start).join(""), removed: false },
      { text: a.slice(start, a.length - end).join(""), removed: true },
      { text: a.slice(a.length - end).join(""), removed: false },
    ];
  }
  const merged: Part[] = [];
  for (const part of parts) {
    if (!part.text) continue;
    const last = merged.at(-1);
    if (last && last.removed === part.removed) last.text += part.text;
    else merged.push({ ...part });
  }
  return merged;
}
