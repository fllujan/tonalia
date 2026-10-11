import type { PlaylistNode } from "../../lib/rpc.types";
import type { DragPayload } from "./dragStore";
import { canDrop } from "./rules";
import { buildTree, isWithin, movePlan, zoneFor } from "./tree";

function node(
  id: number,
  parentId: number | null,
  extra: Partial<PlaylistNode> = {},
): PlaylistNode {
  return {
    id,
    parentId,
    name: `P${id}`,
    emoji: null,
    isFolder: false,
    smart: null,
    sortOrder: 0,
    trackCount: 0,
    ...extra,
  };
}

// 1 Bolos/ (2 Warm-up, 3 Peak, 4 Sub/ (5 Deep)) · 6 Loose · 7 Smart
const FLAT = [
  node(1, null, { isFolder: true }),
  node(2, 1),
  node(3, 1),
  node(4, 1, { isFolder: true }),
  node(5, 4),
  node(6, null),
  node(7, null, { smart: { energyMin: 8 } }),
];

test("buildTree nests children and filters top-level nodes", () => {
  const tree = buildTree(FLAT, (n) => n.smart == null);
  expect(tree.map((t) => t.node.id)).toEqual([1, 6]);
  expect(tree[0]?.children.map((t) => [t.node.id, t.depth])).toEqual([
    [2, 1],
    [3, 1],
    [4, 1],
  ]);
  expect(tree[0]?.children[2]?.children[0]?.node.id).toBe(5);
});

test("isWithin follows parents", () => {
  expect(isWithin(FLAT, 1, 5)).toBe(true);
  expect(isWithin(FLAT, 4, 4)).toBe(true);
  expect(isWithin(FLAT, 4, 2)).toBe(false);
  expect(isWithin(FLAT, 1, null)).toBe(false);
});

test("zoneFor splits folders in three and playlists in two", () => {
  expect(zoneFor(true, 2, 30)).toBe("before");
  expect(zoneFor(true, 15, 30)).toBe("inside");
  expect(zoneFor(true, 28, 30)).toBe("after");
  expect(zoneFor(false, 10, 30)).toBe("before");
  expect(zoneFor(false, 20, 30)).toBe("after");
  expect(zoneFor(true, 0, 0)).toBe("inside");
  expect(zoneFor(false, 0, 0)).toBe("after");
});

test("movePlan computes parent and index, refusing cycles", () => {
  expect(movePlan(FLAT, 6, 1, "inside")).toEqual({ parentId: 1, index: 3 });
  expect(movePlan(FLAT, 6, 3, "before")).toEqual({ parentId: 1, index: 1 });
  expect(movePlan(FLAT, 2, 3, "after")).toEqual({ parentId: 1, index: 1 });
  expect(movePlan(FLAT, 5, 6, "after")).toEqual({ parentId: null, index: 2 });
  expect(movePlan(FLAT, 1, 5, "after")).toBeNull();
  expect(movePlan(FLAT, 1, 1, "inside")).toBeNull();
  expect(movePlan(FLAT, 6, 2, "inside")).toBeNull();
});

test("canDrop keeps tracks out of folders and smart playlists", () => {
  const tracks: DragPayload = { kind: "tracks", trackIds: [1], label: "x" };
  expect(canDrop(tracks, { kind: "playlist", id: 2, zone: "after" }, FLAT)).toBe(true);
  expect(canDrop(tracks, { kind: "playlist", id: 1, zone: "inside" }, FLAT)).toBe(false);
  expect(canDrop(tracks, { kind: "playlist", id: 7, zone: "after" }, FLAT)).toBe(false);
  expect(canDrop(tracks, { kind: "row", index: 0 }, FLAT)).toBe(true);

  const folder = { kind: "playlist", id: 1, label: "", smart: false, isFolder: true } as const;
  expect(canDrop(folder, { kind: "playlist", id: 5, zone: "after" }, FLAT)).toBe(false);
  expect(canDrop(folder, { kind: "playlist", id: 6, zone: "before" }, FLAT)).toBe(true);
  expect(canDrop(folder, { kind: "playlist", id: 7, zone: "before" }, FLAT)).toBe(false);
  expect(canDrop(folder, { kind: "row", index: 0 }, FLAT)).toBe(false);

  const smart = { kind: "playlist", id: 7, label: "", smart: true, isFolder: false } as const;
  expect(canDrop(smart, { kind: "playlist", id: 6, zone: "before" }, FLAT)).toBe(false);
});
