/** Score colour (with the number always shown next to it). */
export function scoreTone(score: number): string {
  return score >= 75
    ? "var(--color-success)"
    : score >= 50
      ? "var(--color-warning)"
      : "var(--color-danger)";
}
