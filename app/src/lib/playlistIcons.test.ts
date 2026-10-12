import { iconFor, PLAYLIST_ICONS, playlistLabel } from "./playlistIcons";

describe("playlist icons", () => {
  it("maps every curated emoji to its own icon", () => {
    expect(PLAYLIST_ICONS).toHaveLength(48);
    expect(new Set(PLAYLIST_ICONS.map(([e]) => e)).size).toBe(48);
    expect(new Set(PLAYLIST_ICONS.map(([, i]) => i)).size).toBe(48);
    for (const [emoji, icon] of PLAYLIST_ICONS) expect(iconFor(emoji)).toBe(icon);
  });

  it("accepts the emoji with or without the variation selector", () => {
    expect(iconFor("🎙")).toBe(iconFor("🎙️"));
    expect(iconFor("☀")).toBe(iconFor("☀️"));
  });

  it("leaves other emojis as they are", () => {
    expect(iconFor("🦄")).toBeUndefined();
    expect(iconFor(null)).toBeUndefined();
    expect(playlistLabel({ name: "Peak time", emoji: "🔥" })).toBe("Peak time");
    expect(playlistLabel({ name: "Unicornios", emoji: "🦄" })).toBe("🦄 Unicornios");
    expect(playlistLabel({ name: "Sin icono", emoji: null })).toBe("Sin icono");
  });
});
