// Locale-aware formatting for data shown in the UI. Musical data (BPM, times) use
// tabular, DJ-conventional formats; counts and dates follow the UI language.

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** BPM keeps the DJ convention of a decimal point (two decimals unless configured). */
export function formatBpm(bpm: number | null | undefined, decimals = 2): string {
  return bpm == null ? "—" : bpm.toFixed(decimals);
}

/** Counts with thousands separators, also for 4 digits (DESIGN 7: "1.204"). */
export function formatCount(n: number, locale: string): string {
  return new Intl.NumberFormat(locale, { useGrouping: "always" }).format(n);
}

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** File sizes in decimal units, as the OS file managers show them: "337 MB", "1,3 GB". */
export function formatBytes(bytes: number, locale: string): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit++;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  const text = new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
  return `${text} ${UNITS[unit]}`;
}

export function formatDate(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

/** Last path component, for tracks without a title tag. */
export function fileStem(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/** Semitones with a sign: "+2", "−1", "0". */
export function formatSemitones(value: number): string {
  return value > 0 ? `+${value}` : value < 0 ? `−${-value}` : "0";
}

/** A rough waiting time: "40 s", "2½ min", "12 min" (5 s, half-minute, then minute steps). */
export function formatWait(seconds: number): string {
  if (seconds < 55) return `${Math.max(5, Math.round(seconds / 5) * 5)} s`;
  const minutes = seconds / 60;
  const halves = minutes >= 10 ? Math.round(minutes) * 2 : Math.round(minutes * 2);
  const whole = Math.floor(halves / 2);
  return halves % 2 ? `${whole}½ min` : `${whole} min`;
}
