// Curated playlist icons: playlists keep an emoji (SPEC 2.11), drawn as a line icon when it
// is one of these.
import {
  Activity,
  AudioLines,
  Clock,
  Coffee,
  Compass,
  Crown,
  Disc,
  Disc3,
  Drum,
  Flag,
  FlaskConical,
  Flame,
  FolderClosed,
  Gem,
  GlassWater,
  Guitar,
  Headphones,
  Heart,
  Leaf,
  Library,
  type LucideIcon,
  Martini,
  Mic,
  Moon,
  Mountain,
  Music,
  Orbit,
  PartyPopper,
  Piano,
  Radar,
  Radio,
  Rainbow,
  Rocket,
  SlidersHorizontal,
  SlidersVertical,
  Snowflake,
  Sparkles,
  Star,
  Sun,
  Sunrise,
  Sunset,
  Target,
  Telescope,
  TreePalm,
  Volume2,
  WandSparkles,
  Waves,
  Wine,
  Zap,
} from "lucide-react";

/** The curated set, in picker order (6 rows of 8). */
export const PLAYLIST_ICONS: readonly (readonly [emoji: string, icon: LucideIcon])[] = [
  ["🎵", Music], ["🎶", AudioLines], ["🎧", Headphones], ["🎛️", SlidersHorizontal],
  ["🎚️", SlidersVertical], ["🎙️", Mic], ["💿", Disc3], ["📀", Disc],
  ["🔊", Volume2], ["🎹", Piano], ["🥁", Drum], ["🎸", Guitar],
  ["📻", Radio], ["📡", Radar], ["💥", Activity], ["⚡", Zap],
  ["🔥", Flame], ["🚀", Rocket], ["🌅", Sunrise], ["🌇", Sunset],
  ["🌙", Moon], ["☀️", Sun], ["⭐", Star], ["✨", Sparkles],
  ["🔮", Orbit], ["🌌", Telescope], ["🌈", Rainbow], ["🌊", Waves],
  ["🏝️", TreePalm], ["🍃", Leaf], ["🏔️", Mountain], ["❄️", Snowflake],
  ["🍹", GlassWater], ["🍸", Martini], ["🥂", Wine], ["☕", Coffee],
  ["🎉", PartyPopper], ["💎", Gem], ["👑", Crown], ["❤️", Heart],
  ["🧪", FlaskConical], ["🧭", Compass], ["🕓", Clock], ["🎯", Target],
  ["🗂️", Library], ["📁", FolderClosed], ["🏁", Flag], ["🪄", WandSparkles],
]; // prettier-ignore

const BY_EMOJI = new Map<string, LucideIcon>(PLAYLIST_ICONS);
// Spellings of the same emoji with or without the variation selector.
for (const [emoji, icon] of PLAYLIST_ICONS) BY_EMOJI.set(emoji.replace(/️/g, ""), icon);
BY_EMOJI.set("🌴", TreePalm);
BY_EMOJI.set("🕒", Clock);

export function iconFor(emoji: string | null | undefined): LucideIcon | undefined {
  if (!emoji) return undefined;
  return BY_EMOJI.get(emoji) ?? BY_EMOJI.get(emoji.replace(/️/g, ""));
}

/** A name for plain text (select options, drag labels): curated emojis are left out. */
export function playlistLabel(p: { name: string; emoji?: string | null }): string {
  return p.emoji && !iconFor(p.emoji) ? `${p.emoji} ${p.name}` : p.name;
}
