// Shared rules for keyboard shortcuts (SPEC 2.14, 10.1).

export const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

/** "⌘" on macOS, "Ctrl" elsewhere. */
export const MOD = isMac ? "⌘" : "Ctrl";

/**
 * True when a plain-key shortcut (space, arrows, digits) must not fire: the user is typing,
 * a dialog is open, a modifier is held, or the focused control uses that key itself.
 */
export function ownsKey(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return true;
  const target = e.target instanceof Element ? e.target : null;
  if (!target) return false;
  if (target.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return true;
  if (document.querySelector("[role=dialog][aria-modal=true]")) return true;
  if (e.key === " " || e.key === "Enter")
    return (
      target.closest(
        "button, a, [role=button], [role=radio], [role=switch], [role=row], [role=option], [role=menuitem], [role=treeitem]",
      ) != null
    );
  if (e.key.startsWith("Arrow"))
    return (
      target.closest(
        "[role=slider], [role=radiogroup], [role=row], [role=listbox], [role=option], [role=tree], [role=menu], [role=tablist]",
      ) != null
    );
  return false;
}
