// The part of a tag value that changed (DESIGN 5.16: "the difference highlighted"):
// what `after` keeps from the start and end of `before`, and the new middle. Works on
// code points so an emoji is never split.
export interface ChangedSpan {
  prefix: string;
  changed: string;
  suffix: string;
}

export function changedSpan(before: string, after: string): ChangedSpan {
  const a = Array.from(before);
  const b = Array.from(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  )
    end++;
  return {
    prefix: b.slice(0, start).join(""),
    changed: b.slice(start, b.length - end).join(""),
    suffix: b.slice(b.length - end).join(""),
  };
}
