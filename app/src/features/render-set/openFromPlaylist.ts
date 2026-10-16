// "Render set…" from a playlist's menu: the playlist in its order (SPEC 14.2).
import { request } from "../../lib/rpc";
import { fileStem } from "../../lib/format";
import { useRenderSet } from "./store";

export async function openRenderSet(playlistId: number, name: string): Promise<void> {
  const page = await request("library.list", {
    playlistId,
    sort: "position",
    descending: false,
    limit: 500,
  });
  useRenderSet.getState().open({
    playlistId,
    name,
    titles: page.items.map((t) => t.title ?? fileStem(t.path)),
    firstBpm: page.items[0]?.bpm ?? undefined,
  });
}
