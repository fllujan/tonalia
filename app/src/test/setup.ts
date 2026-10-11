import "@testing-library/jest-dom/vitest";
import "../i18n";

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
