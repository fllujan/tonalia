// Track artwork: the file's cover, or a cover generated from the track's key.
import { fireEvent, render } from "@testing-library/react";
import { makeKey } from "../lib/keys";
import { Artwork } from "./Artwork";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
}));

describe("Artwork", () => {
  it("shows the file's cover", () => {
    const { container } = render(<Artwork path="/covers/a.jpg" musicalKey={null} size={28} />);
    expect(container.querySelector("img")?.getAttribute("src")).toContain("a.jpg");
    expect(container.querySelector("[data-generated]")).toBeNull();
  });

  it("generates one in the colour of the key, lighting its place on the wheel", () => {
    const key = makeKey(9, "minor"); // Am = 8A
    const { container } = render(<Artwork path={null} musicalKey={key} size={120} />);
    const cover = container.querySelector("[data-generated]");
    expect(cover).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(cover?.getAttribute("style")).toContain("--color-key-8a");
    const lit = container.querySelectorAll("[data-lit]");
    expect(lit).toHaveLength(1);
    expect(lit[0]?.getAttribute("data-lit")).toBe("8A");
  });

  it("stays neutral without a key, and falls back when the file cannot load", () => {
    const { container } = render(<Artwork path="/gone.jpg" musicalKey={null} size={44} />);
    fireEvent.error(container.querySelector("img") as HTMLImageElement);
    const cover = container.querySelector("[data-generated]");
    expect(cover).not.toBeNull();
    expect(cover?.getAttribute("style")).not.toContain("--color-key");
    expect(container.querySelectorAll("[data-lit]")).toHaveLength(0);
  });
});
