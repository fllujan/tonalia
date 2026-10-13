// The built-in guides, in the order of their index.
export const GUIDES = ["harmonic", "energy", "cues", "stems"] as const;
export type Guide = (typeof GUIDES)[number];
