// End-to-end smoke test of the Pro flow (SPEC phase 8 acceptance): the real UI against the
// real engine (Python, ffmpeg, Rubber Band, SQLite) on a synthetic library:
//   add a folder → analysis → load A → pick an idea → change the key → try the mashup
//   → save the favorite → export its two processed files.
// What stands in: the Rust core (EngineBridge plays its part over stdio), the webview's
// Web Audio (FakeAudioContext records the scheduling) and the OS folder picker.
// tauri-driver cannot drive WKWebView, so on macOS this is the E2E run; see PROGRESS.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../src/App";
import { useDecksStore } from "../src/features/decks/decksStore";
import { usePlaybackStore, setAudioContextFactory, player } from "../src/features/decks/syncPlayer";
import i18n from "../src/i18n";
import { createQueryClient } from "../src/lib/queryClient";
import type { Favorite, LibraryPage, RenderSpec } from "../src/lib/rpc.types";
import { FakeAudioContext } from "../src/test/fakeAudio";
import { bridge } from "./engineBridge";

const picker = vi.hoisted(() => ({ next: [] as string[] }));

vi.mock("@tauri-apps/api/core", async () => {
  const { bridge } = await import("./engineBridge");
  return {
    invoke: (cmd: string, args: { method?: string; params?: unknown }) => bridge.invoke(cmd, args),
    convertFileSrc: (path: string) => path,
  };
});
vi.mock("@tauri-apps/api/event", async () => {
  const { bridge } = await import("./engineBridge");
  return {
    listen: (name: string, cb: (ev: { payload: unknown }) => void) => bridge.listen(name, cb),
  };
});
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: () => Promise.resolve(() => undefined) }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(() => Promise.resolve(picker.next.shift() ?? null)),
  save: vi.fn(),
}));

const ENGINE = resolve(__dirname, "../../engine");
const work = mkdtempSync(join(tmpdir(), "tonalia-e2e-"));
const music = join(work, "Música de prueba ✨");
const exports = join(work, "Proyecto DAW");
const ctx = new FakeAudioContext();

beforeAll(async () => {
  execFileSync("uv", ["run", "--quiet", "python", "-m", "tests.fixtures.e2e", music], {
    cwd: ENGINE,
  });
  await bridge.start(ENGINE, join(work, "data"));
  setAudioContextFactory(() => ctx as unknown as AudioContext);
  // The webview fetches renders through the asset protocol; here, straight from disk.
  vi.stubGlobal("fetch", (path: string) => {
    const bytes = readFileSync(path);
    return Promise.resolve({
      ok: true,
      arrayBuffer: () =>
        Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length)),
    });
  });
  await i18n.changeLanguage("es");
}, 120_000);

afterAll(async () => {
  player.stop();
  vi.unstubAllGlobals();
  await bridge.stop();
  rmSync(work, { recursive: true, force: true });
});

const engine = <T,>(method: string, params?: unknown) =>
  bridge.request(method, params) as Promise<T>;
const renders = () =>
  bridge.calls.filter((c) => c.method === "render.preview").map((c) => c.params as RenderSpec);

it("loads A, picks an idea, changes the key, tries it, saves it and exports its stems", async () => {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <App />
    </QueryClientProvider>,
  );

  // 1. Add the folder from the welcome screen: import + analysis in the engine.
  picker.next.push(music);
  await userEvent.click(
    await screen.findByRole("button", { name: "Elegir carpeta…" }, { timeout: 30_000 }),
  );
  await waitFor(
    async () => {
      const page = await engine<LibraryPage>("library.list", { limit: 50 });
      expect(page.items).toHaveLength(4);
      expect(page.items.every((t) => t.status === "ready")).toBe(true);
    },
    { timeout: 150_000, interval: 1000 },
  );
  const page = await engine<LibraryPage>("library.list", { limit: 50 });
  // No tags: the UI names the tracks after their files.
  const name = (t: { path: string }) =>
    t.path
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.flac$/, "") ?? "";
  const byTitle = (prefix: string) => page.items.find((t) => name(t).startsWith(prefix));
  const a = byTitle("Noche en La menor");
  expect(a).toMatchObject({ keyRoot: 9, keyMode: "minor" });
  expect(a?.bpm).toBeCloseTo(124, 0);

  // 2. Pro mode: load A; deck B shows the best idea from the real idea engine.
  const workspace = await screen.findByRole("radiogroup", { name: "Espacio de trabajo" });
  await userEvent.click(within(workspace).getByRole("radio", { name: "Pro" }));
  const results = await screen.findByRole("list", { name: "Temas analizados" });
  await userEvent.click(await within(results).findByText(/Noche en La menor/));
  await screen.findByRole("region", { name: /^Deck A: Noche en La menor/ }, { timeout: 15_000 });
  const firstB = await screen.findByRole("region", { name: /^Deck B: / }, { timeout: 15_000 });
  expect(within(firstB).getByText(/^Idea 1 \/ 3$/)).toBeInTheDocument();
  // Pick another idea with the arrows.
  await userEvent.click(within(firstB).getByRole("button", { name: "Idea siguiente" }));
  await waitFor(() => expect(screen.getByText(/^Idea 2 \/ 3$/)).toBeInTheDocument());
  const picked = screen.getByRole("region", { name: /^Deck B: / }).getAttribute("aria-label");

  // 3. Change A's key: the engine recalculates the ideas for the shifted key.
  const pitchA = screen.getByRole("group", { name: "Tono de Deck A" });
  await userEvent.click(within(pitchA).getByRole("button", { name: "Subir un semitono" }));
  await waitFor(() =>
    expect(bridge.calls.filter((c) => c.method === "suggest.mashups").at(-1)?.params).toMatchObject(
      {
        shiftA: 1,
      },
    ),
  );
  // B stays on the picked track while the new ideas still include it.
  await waitFor(() => expect(useDecksStore.getState().keepB).toBeNull());
  const deckB = await screen.findByRole("region", { name: /^Deck B: / });
  if (deckB.getAttribute("aria-label") === picked)
    expect(within(deckB).getByText(/^Idea \d \//)).toBeInTheDocument();
  else expect(within(deckB).getByText(/^Idea 1 \//)).toBeInTheDocument();
  const bTitle = deckB.getAttribute("aria-label")?.replace("Deck B: ", "") ?? "";
  const b = page.items.find((t) => name(t) === bTitle);
  expect(b).toBeTruthy();

  // 4. Try the mashup: both segments rendered by Rubber Band, downbeats on one instant.
  await userEvent.click(screen.getByRole("button", { name: "Probar mashup" }));
  await waitFor(() => expect(usePlaybackStore.getState().status).toBe("playing"), {
    timeout: 60_000,
  });
  // (The speculative pre-render of the next idea may be asked for in between.)
  const ra = renders()
    .filter((r) => r.trackId === a?.id)
    .at(-1);
  const rb = renders()
    .filter((r) => r.trackId === b?.id)
    .at(-1);
  expect(ra).toMatchObject({ semitones: 1, targetBpm: null });
  expect(rb?.targetBpm).toBeCloseTo(a?.bpm ?? 0, 1);
  expect(ctx.started).toHaveLength(2);
  await userEvent.click(screen.getByRole("button", { name: "Parar" }));

  // 5. Save the favorite and rate it.
  await userEvent.click(screen.getByRole("button", { name: "Guardar favorito" }));
  await screen.findByRole("button", { name: "En favoritos" }, { timeout: 10_000 });
  const rating = screen.getByRole("radiogroup", { name: "Valoración" });
  await userEvent.click(within(rating).getByRole("radio", { name: "4 estrellas" }));
  await waitFor(async () => {
    const { items } = await engine<{ items: Favorite[] }>("favorites.list");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ trackA: a?.id, trackB: b?.id, shiftA: 1, rating: 4 });
  });

  // 6. Export the favorite's stems: the two processed files, to a folder.
  await userEvent.click(screen.getByRole("button", { name: "Exportar stems" }));
  const dialog = await screen.findByRole("dialog", { name: "Exportar favorito" });
  picker.next.push(exports);
  await userEvent.click(within(dialog).getByRole("button", { name: "Elegir carpeta…" }));
  const submit = await within(dialog).findByRole("button", { name: "Exportar 2 archivos" });
  await waitFor(() => expect(submit).toBeEnabled(), { timeout: 15_000 });
  await userEvent.click(submit);
  await screen.findByText("2 archivos exportados", undefined, { timeout: 120_000 });
  const files = readdirSync(exports).filter((f) => f.endsWith(".wav"));
  expect(files).toHaveLength(2);
  for (const f of files) expect(statSync(join(exports, f)).size).toBeGreaterThan(1_000_000);
  expect(files.some((f) => f.includes("Noche en La menor"))).toBe(true);
}, 400_000);

// Runs after the flow above (same engine and library).
it("builds a set from a playlist with the real set builder and saves it", async () => {
  const page = await engine<LibraryPage>("library.list", { limit: 50 });
  const pool = await engine<{ id: number }>("playlists.create", { name: "Pool E2E" });
  await engine("playlists.addTracks", {
    playlistId: pool.id,
    trackIds: page.items.map((t) => t.id),
  });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <App />
    </QueryClientProvider>,
  );
  await userEvent.click(await screen.findByRole("button", { name: /Constructor de sets/ }));
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Origen" }),
    await screen.findByRole("option", { name: "Pool E2E" }),
  );
  await userEvent.click(screen.getByRole("radio", { name: "Nº de temas" }));
  const count = screen.getByRole("spinbutton", { name: "Temas" });
  await userEvent.clear(count);
  await userEvent.type(count, "4");
  await userEvent.click(screen.getByRole("radio", { name: "Ascenso" }));
  await userEvent.click(screen.getByRole("button", { name: "Generar set" }));

  const list = await screen.findByRole("list", { name: "Set" }, { timeout: 15_000 });
  expect(within(list).getAllByRole("listitem")).toHaveLength(4);
  expect(within(list).getAllByRole("group", { name: /^Transición/ })).toHaveLength(3);
  expect(screen.getByText(/Media de transición/)).toBeInTheDocument();
  // The tracks are distinct and the engine was asked for an ascending curve of 4.
  expect(bridge.calls.filter((c) => c.method === "builder.generate").at(-1)?.params).toMatchObject({
    pool: { playlistId: pool.id },
    count: 4,
    curve: { preset: "ascending" },
  });

  await userEvent.click(screen.getByRole("button", { name: "Guardar como playlist" }));
  await screen.findByText(/Guardado como playlist/, undefined, { timeout: 10_000 });
  const { playlists } = await engine<{
    playlists: { id: number; name: string; emoji: string | null }[];
  }>("playlists.tree");
  const saved = playlists.find((p) => p.emoji === "🧭");
  expect(saved?.name).toMatch(/^Set /);
  const tracks = await engine<LibraryPage>("library.list", {
    playlistId: saved?.id,
    sort: "position",
    descending: false,
  });
  expect(tracks.items.map((t) => t.id)).toEqual(
    within(list)
      .getAllByRole("listitem")
      .map(
        (li) =>
          page.items.find((t) =>
            li.getAttribute("aria-label")?.endsWith(
              t.path
                .split(/[\\/]/)
                .pop()
                ?.replace(/\.flac$/, "") ?? "?",
            ),
          )?.id,
      ),
  );
}, 120_000);
