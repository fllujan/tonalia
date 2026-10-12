// One sound source at a time: the library player (one track) and the Pro decks (two synced
// tracks) stop each other when they start, so a track never plays over a mashup.

type Owner = "track" | "decks";

let current: { owner: Owner; stop: () => void } | null = null;

/** Take the audio output for `owner`; whoever held it before is stopped. */
export function claimAudio(owner: Owner, stop: () => void): void {
  const previous = current;
  current = { owner, stop };
  if (previous && previous.owner !== owner) previous.stop();
}

/** Give the output back (only if `owner` still holds it). */
export function releaseAudio(owner: Owner): void {
  if (current?.owner === owner) current = null;
}
