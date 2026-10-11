// "Show in Finder/Explorer" for files Tonalia wrote (Rust checks the path: src/reveal.rs).
import { invoke } from "@tauri-apps/api/core";

export function revealFile(path: string): Promise<void> {
  return invoke("reveal_file", { path });
}
