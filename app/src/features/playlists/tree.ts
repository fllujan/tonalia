// Pure helpers over the flat playlist list the engine returns (parents before children,
// siblings in order).
import type { PlaylistNode } from "../../lib/rpc.types";

export interface TreeNode {
  node: PlaylistNode;
  depth: number;
  children: TreeNode[];
}

/** Nested view of the flat list; `include` filters top-level nodes (children follow). */
export function buildTree(
  flat: PlaylistNode[],
  include: (node: PlaylistNode) => boolean = () => true,
): TreeNode[] {
  const byParent = new Map<number | null, PlaylistNode[]>();
  for (const node of flat) {
    const list = byParent.get(node.parentId) ?? [];
    list.push(node);
    byParent.set(node.parentId, list);
  }
  const grow = (parent: number | null, depth: number): TreeNode[] =>
    (byParent.get(parent) ?? [])
      .filter((node) => depth > 0 || include(node))
      .map((node) => ({ node, depth, children: grow(node.id, depth + 1) }));
  return grow(null, 0);
}

/** True when `id` is `ancestorId` or nested anywhere inside it. */
export function isWithin(flat: PlaylistNode[], ancestorId: number, id: number | null): boolean {
  const parentOf = new Map(flat.map((n) => [n.id, n.parentId]));
  for (let current = id; current != null; current = parentOf.get(current) ?? null) {
    if (current === ancestorId) return true;
  }
  return false;
}

export type DropZone = "before" | "after" | "inside";

/**
 * Where a pointer at `offsetY` within a row of `height` drops: folders take the middle
 * half as "inside"; other rows split in two. Rows without layout (tests) drop inside a
 * folder and after anything else.
 */
export function zoneFor(isFolder: boolean, offsetY: number, height: number): DropZone {
  if (height <= 0) return isFolder ? "inside" : "after";
  const ratio = offsetY / height;
  if (isFolder) return ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "inside";
  return ratio < 0.5 ? "before" : "after";
}

/** The `playlists.move` arguments for dropping `draggedId` on `targetId`, or null. */
export function movePlan(
  flat: PlaylistNode[],
  draggedId: number,
  targetId: number,
  zone: DropZone,
): { parentId: number | null; index: number } | null {
  const target = flat.find((n) => n.id === targetId);
  if (!target || isWithin(flat, draggedId, targetId)) return null;
  if (zone === "inside") {
    if (!target.isFolder) return null;
    const count = flat.filter((n) => n.parentId === target.id && n.id !== draggedId).length;
    return { parentId: target.id, index: count };
  }
  const siblings = flat.filter((n) => n.parentId === target.parentId && n.id !== draggedId);
  const at = siblings.findIndex((n) => n.id === targetId);
  return { parentId: target.parentId, index: zone === "before" ? at : at + 1 };
}
