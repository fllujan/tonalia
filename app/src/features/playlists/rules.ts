import type { PlaylistNode } from "../../lib/rpc.types";
import type { DragPayload, DropTarget } from "./dragStore";
import { movePlan } from "./tree";

/** Whether `payload` may be dropped on `target` (drives highlighting and the drop). */
export function canDrop(payload: DragPayload, target: DropTarget, tree: PlaylistNode[]): boolean {
  if (target.kind === "row") return payload.kind === "tracks";
  const node = tree.find((n) => n.id === target.id);
  if (!node) return false;
  if (payload.kind === "tracks") return !node.isFolder && node.smart == null;
  if (payload.id === node.id) return false;
  // Smart playlists are reordered among themselves; the rest never mixes with them.
  if (payload.smart) return node.smart != null && target.zone !== "inside";
  if (node.smart != null) return false;
  return movePlan(tree, payload.id, node.id, target.zone) !== null;
}
