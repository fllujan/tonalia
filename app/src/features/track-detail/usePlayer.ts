// The detail view's transport, backed by the shared library player (features/player): if
// the track is already playing in the bottom bar it simply keeps going here, and pressing
// play here loads it there. Until then, seeking only moves a local playhead.
import { useCallback, useMemo, useState } from "react";
import {
  loadTrack,
  pause as pausePlayer,
  type PlayableTrack,
  seek as seekPlayer,
  togglePlayback,
  usePlayerStore,
} from "../player/playerStore";

export interface Player {
  playing: boolean;
  time: number;
  error: string | null;
  toggle: () => void;
  /** Start playing, from `at` seconds when given. */
  play: (at?: number) => void;
  pause: () => void;
  seek: (time: number) => void;
}

export function usePlayer(track: PlayableTrack | null | undefined): Player {
  const id = track?.id;
  const loaded = usePlayerStore((s) => id != null && s.track?.id === id);
  const playing = usePlayerStore((s) => loaded && s.playing);
  const liveTime = usePlayerStore((s) => (loaded ? s.time : 0));
  const error = usePlayerStore((s) => (loaded ? s.error : null));
  const [cursor, setCursor] = useState(0);

  const play = useCallback(
    (at?: number) => {
      if (track) loadTrack(track, { play: true, at: at ?? (loaded ? undefined : cursor) });
    },
    [track, loaded, cursor],
  );
  const toggle = useCallback(() => {
    if (!track) return;
    if (loaded) togglePlayback(track);
    else loadTrack(track, { play: true, at: cursor });
  }, [track, loaded, cursor]);
  const seek = useCallback(
    (time: number) => {
      if (loaded) seekPlayer(time);
      else setCursor(Math.max(0, time));
    },
    [loaded],
  );
  const pause = useCallback(() => {
    if (loaded) pausePlayer();
  }, [loaded]);

  return useMemo(
    () => ({ playing, time: loaded ? liveTime : cursor, error, toggle, play, pause, seek }),
    [playing, loaded, liveTime, cursor, error, toggle, play, pause, seek],
  );
}
