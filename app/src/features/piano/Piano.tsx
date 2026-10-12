// Verification piano (SPEC 2.13, DESIGN 5.12): two octaves (C3–C5) playable with the mouse
// and, while focused, the computer keyboard (A W S E D F T G Y H U J K O L P; Z/X change
// octave). The key's scale is marked with dots in its wheel colour, the tonic larger.
import {
  type CSSProperties,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Switch } from "../../components/Switch";
import { formatKey, type Key, type Notation } from "../../lib/keys";
import { keyColor } from "../../lib/keyStyle";
import {
  BASES,
  codeForNote,
  HIGH,
  isBlack,
  LOW,
  noteForCode,
  scaleNotes,
  scalePitchClasses,
  spellScale,
  tonicChord,
} from "./music";
import { type Synth, webAudioSynth } from "./synth";

const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"] as const;
const noteName = (midi: number) => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;

const WHITE_W = 28;
const BLACK_W = 18;
const CHORD_SECONDS = 1.5;
const SCALE_STEP = 0.32;
const SCALE_NOTE = 0.45;
const TAP_SECONDS = 0.6;

const NOTES = Array.from({ length: HIGH - LOW + 1 }, (_, i) => LOW + i);
const WHITES = NOTES.filter((m) => !isBlack(m));

export function Piano({
  musicalKey,
  notation,
  synth = webAudioSynth,
  withTrack,
}: {
  musicalKey: Key | null;
  notation: Notation;
  synth?: Synth;
  /** "Play along with the track" switch (the detail view starts/stops its player). */
  withTrack?: { checked: boolean; onChange: (checked: boolean) => void };
}) {
  const { t } = useTranslation();
  const [pressed, setPressed] = useState<ReadonlySet<number>>(new Set());
  const [base, setBase] = useState<number>(BASES[0]);
  /** Notes held by the mouse or a computer key: id → (note, release). */
  const held = useRef(new Map<string, { midi: number; stop: () => void }>());
  const timers = useRef<number[]>([]);

  const press = useCallback((midi: number, on: boolean) => {
    setPressed((prev) => {
      const next = new Set(prev);
      if (on) next.add(midi);
      else next.delete(midi);
      return next;
    });
  }, []);

  useEffect(() => {
    const pending = timers.current;
    const notes = held.current;
    return () => {
      for (const id of pending) window.clearTimeout(id);
      for (const note of notes.values()) note.stop();
    };
  }, []);

  /** Light a key from `delay` for `duration` seconds (chords, scales, taps). */
  const flash = (midi: number, delay: number, duration: number) => {
    timers.current.push(
      window.setTimeout(() => press(midi, true), delay * 1000),
      window.setTimeout(() => press(midi, false), (delay + duration) * 1000),
    );
  };

  const schedule = (notes: number[], step: number, duration: number) => {
    notes.forEach((midi, i) => {
      synth.play(midi, i * step, duration);
      if (i * step === 0) press(midi, true); // light now, not on the next tick
      flash(midi, i * step, duration);
    });
  };

  const hold = (id: string, midi: number) => {
    if (held.current.has(id)) return;
    held.current.set(id, { midi, stop: synth.start(midi) });
    press(midi, true);
  };
  const release = (id: string) => {
    const note = held.current.get(id);
    if (!note) return;
    note.stop();
    held.current.delete(id);
    press(note.midi, false);
  };
  const releaseAll = () => {
    for (const id of [...held.current.keys()]) release(id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === "KeyZ" || e.code === "KeyX") {
      e.preventDefault();
      setBase(e.code === "KeyZ" ? BASES[0] : BASES[1]);
      return;
    }
    const midi = noteForCode(e.code, base);
    if (midi == null) return;
    e.preventDefault();
    if (!e.repeat) hold(e.code, midi);
  };

  const scale = musicalKey ? new Set(scalePitchClasses(musicalKey)) : null;
  const color = musicalKey ? keyColor(musicalKey) : undefined;

  const keyButton = (midi: number) => {
    const black = isBlack(midi);
    const inScale = scale?.has(midi % 12) ?? false;
    const tonic = musicalKey != null && midi % 12 === musicalKey.root;
    const on = pressed.has(midi);
    const letter = codeForNote(midi, base);
    const whiteIndex = WHITES.filter((w) => w < midi).length;
    const label = [noteName(midi), tonic ? t("piano.tonic") : inScale ? t("piano.inScale") : null]
      .filter(Boolean)
      .join(" · ");
    const id = `pointer-${midi}`;
    const style: CSSProperties = black
      ? { left: whiteIndex * WHITE_W - BLACK_W / 2, width: BLACK_W }
      : { left: whiteIndex * WHITE_W, width: WHITE_W };
    return (
      <button
        key={midi}
        type="button"
        tabIndex={-1}
        aria-label={label}
        data-scale={tonic ? "tonic" : inScale ? "note" : undefined}
        data-pressed={on || undefined}
        onPointerDown={(e) => {
          e.preventDefault();
          (e.currentTarget.closest("[role=group]") as HTMLElement | null)?.focus();
          hold(id, midi);
        }}
        onPointerUp={() => release(id)}
        onPointerLeave={() => release(id)}
        onClick={(e) => {
          if (e.detail !== 0) return; // mouse clicks already played on pointer down
          synth.play(midi, 0, TAP_SECONDS);
          flash(midi, 0, TAP_SECONDS);
        }}
        style={style}
        className={`absolute top-0 flex flex-col items-center justify-end outline-none transition-colors duration-hover focus-visible:ring-2 focus-visible:ring-primary ${
          black
            ? `z-10 h-[76px] rounded-b-[4px] pb-1.5 ${on ? "bg-primary" : "bg-piano-black"}`
            : `h-[120px] rounded-b-sm border border-border pb-1.5 ${on ? "bg-primary" : "bg-piano-white"}`
        }`}
      >
        {inScale && (
          <span
            aria-hidden
            className={`mb-1 rounded-pill ${tonic ? "size-2.5" : "size-1.5"}`}
            style={{ backgroundColor: color }}
          />
        )}
        {letter && (
          <span
            aria-hidden
            className={`font-mono text-[9px] leading-none ${black ? "text-piano-white/60" : "text-piano-black/50"}`}
          >
            {letter}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        role="group"
        aria-label={t("piano.title")}
        aria-describedby="piano-help"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => release(e.code)}
        onBlur={releaseAll}
        className="relative h-[120px] shrink-0 select-none rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        style={{ width: WHITES.length * WHITE_W }}
      >
        {WHITES.map(keyButton)}
        {NOTES.filter(isBlack).map(keyButton)}
      </div>
      <p id="piano-help" className="text-[12px] text-text-3">
        {t("piano.help")}
      </p>
      {/* The letters sit on the octave the computer keyboard plays; this says which,
          and moves it with the mouse too (Z / X from the keyboard). */}
      <div className="flex items-center gap-2 text-[12px] text-text-2">
        <span id="piano-octave">{t("piano.octave")}</span>
        <div
          role="group"
          aria-labelledby="piano-octave"
          className="flex gap-0.5 rounded-[7px] border border-border bg-bg p-0.5"
        >
          {BASES.map((b, i) => (
            <button
              key={b}
              type="button"
              aria-pressed={base === b}
              onClick={() => setBase(b)}
              className={`flex h-6 items-center gap-1.5 rounded-[5px] px-2 transition-colors duration-hover ${base === b ? "bg-surface-3 text-text" : "text-text-3 hover:text-text"}`}
            >
              <kbd className="font-mono text-[11px] text-text-3">{i === 0 ? "Z" : "X"}</kbd>
              <span className="font-mono">{noteName(b)}</span>
            </button>
          ))}
        </div>
      </div>
      {musicalKey && (
        <p className="text-[12px] text-text-2">
          {t("piano.scaleOf", { key: formatKey(musicalKey, notation) })}{" "}
          <span className="font-mono text-text">{spellScale(musicalKey, notation).join(" ")}</span>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!musicalKey}
          onClick={() => musicalKey && schedule(tonicChord(musicalKey), 0, CHORD_SECONDS)}
          className="h-8 rounded-sm border border-border bg-surface-3 px-3 text-text hover:border-border-strong disabled:opacity-40"
        >
          {t("piano.playChord")}
        </button>
        <button
          type="button"
          disabled={!musicalKey}
          onClick={() => musicalKey && schedule(scaleNotes(musicalKey), SCALE_STEP, SCALE_NOTE)}
          className="h-8 rounded-sm border border-border bg-surface-3 px-3 text-text hover:border-border-strong disabled:opacity-40"
        >
          {t("piano.playScale")}
        </button>
        {withTrack && (
          <div className="ml-2 min-w-[180px]">
            <Switch
              checked={withTrack.checked}
              onChange={withTrack.onChange}
              label={t("piano.withTrack")}
            />
          </div>
        )}
      </div>
    </div>
  );
}
