import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";
import "../i18n";
import { useToastStore } from "../features/toast/toastStore";

// The CI's Intel Mac runner is several times slower than a laptop: the default 1 s that
// findBy*/waitFor wait made whole-app tests (Pro, favorites) fail there at random.
configure({ asyncUtilTimeout: 4000 });

// jsdom has no layout engine: give the virtualized table a ResizeObserver that never
// fires, so it keeps its initial viewport size.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

// Elements report a desktop-sized box (jsdom reports 0), so virtualized lists render rows.
Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
  configurable: true,
  get: () => 800,
});
Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
  configurable: true,
  get: () => 1200,
});

// jsdom implements neither media playback nor canvas drawing.
HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
HTMLMediaElement.prototype.pause = vi.fn();
HTMLCanvasElement.prototype.getContext = vi.fn(
  () => null,
) as unknown as typeof HTMLCanvasElement.prototype.getContext;

// Settings remembers its last section; each test starts from the default one.
beforeEach(() => {
  // Toasts live in a module store: one test's toasts must not show in the next.
  useToastStore.setState({ toasts: [] });
  try {
    localStorage.removeItem("tonalia.settings.section");
  } catch {
    // No storage in this environment.
  }
});
