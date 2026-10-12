// Single-track player for the detail view (HTMLAudioElement; the decks of the Pro mode
// use Web Audio for sample-accurate sync).
import { convertFileSrc } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { allowPlayback } from "./api";
import { errorMessage } from "../../lib/errors";

export interface Player {
  playing: boolean;
  time: number;
  error: string | null;
  toggle: () => void;
  play: () => void;
  pause: () => void;
  seek: (time: number) => void;
}

export function usePlayer(path: string | null | undefined): Player {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!path) return;
    const el = new Audio();
    el.preload = "auto";
    audio.current = el;
    let cancelled = false;
    let frame = 0;
    const tick = () => {
      setTime(el.currentTime);
      frame = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      setPlaying(true);
      frame = requestAnimationFrame(tick);
    };
    const onPause = () => {
      setPlaying(false);
      cancelAnimationFrame(frame);
      setTime(el.currentTime);
    };
    const onError = () => setError(el.error?.message || "unsupported");
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onPause);
    el.addEventListener("error", onError);
    allowPlayback(path)
      .then(() => {
        if (!cancelled) el.src = convertFileSrc(path);
      })
      .catch((err: unknown) => setError(errorMessage(err)));
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      el.pause();
      el.removeAttribute("src");
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onPause);
      el.removeEventListener("error", onError);
      audio.current = null;
    };
  }, [path]);

  const play = useCallback(() => {
    void audio.current?.play().catch(() => undefined);
  }, []);
  const pause = useCallback(() => audio.current?.pause(), []);
  const toggle = useCallback(() => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => undefined);
    else el.pause();
  }, []);
  const seek = useCallback((t: number) => {
    const el = audio.current;
    setTime(Math.max(0, t));
    if (el) el.currentTime = Math.max(0, t);
  }, []);

  return { playing, time, error, toggle, play, pause, seek };
}
