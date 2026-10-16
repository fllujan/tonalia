// The library player (DESIGN, Layout: bottom player): one track at a time, shared by the
// table, the bottom bar and the detail view, so a track keeps playing while the DJ moves
// between them. HTMLAudioElement is enough here; the Pro decks use Web Audio for sync.
import { convertFileSrc } from "@tauri-apps/api/core";
import { create } from "zustand";
import { claimAudio, releaseAudio } from "../../lib/audioFocus";
import { errorMessage } from "../../lib/errors";
import type { TrackSummary } from "../../lib/rpc.types";
import { allowPlayback } from "../track-detail/api";

/** What the player needs to know about a track (a summary or a full detail both fit). */
export type PlayableTrack = Pick<
  TrackSummary,
  "id" | "path" | "title" | "artist" | "artworkPath" | "duration"
>;

interface PlayerState {
  track: PlayableTrack | null;
  playing: boolean;
  time: number;
  error: string | null;
}

export const usePlayerStore = create<PlayerState>(() => ({
  track: null,
  playing: false,
  time: 0,
  error: null,
}));

type SourceResolver = (track: PlayableTrack) => Promise<string>;

let resolveSource: SourceResolver = async (track) => {
  await allowPlayback(track.path);
  return convertFileSrc(track.path);
};

/** The browser preview plays synthetic audio instead of files it cannot reach. */
export function setPlaybackSource(resolver: SourceResolver): void {
  resolveSource = resolver;
}

let audio: HTMLAudioElement | null = null;
let frame = 0;
let generation = 0;

function element(): HTMLAudioElement {
  if (audio) return audio;
  const el = new Audio();
  el.preload = "auto";
  const tick = () => {
    usePlayerStore.setState({ time: el.currentTime });
    frame = requestAnimationFrame(tick);
  };
  el.addEventListener("play", () => {
    claimAudio("track", () => el.pause());
    usePlayerStore.setState({ playing: true });
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(tick);
  });
  const stopped = () => {
    cancelAnimationFrame(frame);
    usePlayerStore.setState({ playing: false, time: el.currentTime });
  };
  // Frames drive a smooth playhead; timeupdate keeps the clock right when frames pause
  // (a hidden window) and after seeks.
  el.addEventListener("timeupdate", () => usePlayerStore.setState({ time: el.currentTime }));
  el.addEventListener("pause", stopped);
  el.addEventListener("ended", stopped);
  el.addEventListener("error", () => {
    if (el.getAttribute("src"))
      usePlayerStore.setState({ error: el.error?.message || "unsupported" });
  });
  audio = el;
  return el;
}

function start(el: HTMLAudioElement): void {
  void el.play().catch(() => undefined);
}

/**
 * Load `track` (keeping it if it is already loaded) and optionally start it at `at`
 * seconds. Loading another track stops the current one.
 */
export function loadTrack(
  track: PlayableTrack,
  { play = false, at }: { play?: boolean; at?: number | undefined } = {},
): void {
  const el = element();
  const state = usePlayerStore.getState();
  if (state.track?.id === track.id && el.getAttribute("src")) {
    if (at !== undefined) seek(at);
    if (play) start(el);
    return;
  }
  const id = ++generation;
  el.pause();
  el.removeAttribute("src");
  usePlayerStore.setState({ track, playing: false, time: at ?? 0, error: null });
  resolveSource(track)
    .then((src) => {
      if (id !== generation) return;
      el.src = src;
      if (at) el.currentTime = at;
      if (play) start(el);
    })
    .catch((err: unknown) => {
      if (id === generation) usePlayerStore.setState({ error: errorMessage(err) });
    });
}

/** Play/pause `track`, or the loaded track when none is given. */
export function togglePlayback(track?: PlayableTrack): void {
  const current = usePlayerStore.getState().track;
  if (track && current?.id !== track.id) {
    loadTrack(track, { play: true });
    return;
  }
  const el = audio;
  if (!el || !current) return;
  if (usePlayerStore.getState().playing) el.pause();
  else start(el);
}

export function play(): void {
  if (audio && usePlayerStore.getState().track) start(audio);
}

export function pause(): void {
  audio?.pause();
}

export function seek(time: number): void {
  const t = Math.max(0, time);
  usePlayerStore.setState({ time: t });
  if (audio?.getAttribute("src")) audio.currentTime = t;
}

/** The playback position right now, read from the audio element (the store's time is
 * only as fresh as the last frame): the metronome schedules its clicks from it. */
export function playbackTime(): number {
  return audio?.getAttribute("src") ? audio.currentTime : usePlayerStore.getState().time;
}

/** Unload the track and hide the bottom player. */
export function closePlayer(): void {
  generation++;
  cancelAnimationFrame(frame);
  if (audio) {
    audio.pause();
    audio.removeAttribute("src");
  }
  releaseAudio("track");
  usePlayerStore.setState({ track: null, playing: false, time: 0, error: null });
}
