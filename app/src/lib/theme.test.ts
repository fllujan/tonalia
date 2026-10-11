import { applyTheme, loadTheme, saveTheme } from "./theme";

describe("theme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("defaults to system", () => {
    expect(loadTheme()).toBe("system");
  });

  it("sets and clears data-theme", () => {
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    applyTheme("system");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("persists the choice", () => {
    saveTheme("dark");
    expect(loadTheme()).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("ignores invalid stored values", () => {
    localStorage.setItem("tonalia.theme", "neon");
    expect(loadTheme()).toBe("system");
  });
});
