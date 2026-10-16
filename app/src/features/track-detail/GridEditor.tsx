// Beatgrid editor (SPEC 12.4, DESIGN 6.17): under the detail waveform, a zoomed view with
// the beat and downbeat lines and the tempo anchors, and the tools to fix the grid by eye
// and by ear: first downbeat here, nudge ±1/±10 ms, BPM with decimals, ×2 ÷2, tap tempo,
// metronome, anchors for a changing tempo, undo/redo. Saving locks the grid.
import {
  Anchor,
  Crosshair,
  Hand,
  Metronome,
  Minus,
  Plus,
  Redo2,
  RotateCcw,
  Trash2,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Segmented } from "../../components/Segmented";
import { Switch } from "../../components/Switch";
import { beatTimes, downbeatTimes } from "../../lib/beats";
import { formatBpm } from "../../lib/format";
import {
  addAnchor,
  doubleTempo,
  type EditorGrid,
  halveTempo,
  MAX_BPM,
  MIN_BPM,
  moveAnchor,
  removeAnchor,
  setBpm,
  setDownbeatAt,
  shiftGrid,
  tapGrid,
  toBeatGrid,
  toSpec,
} from "../../lib/gridEdit";
import { MOD } from "../../lib/keyboard";
import type { TrackDetail } from "../../lib/rpc.types";
import type { WaveformData } from "../../lib/waveform";
import { useToastStore } from "../toast/toastStore";
import { sameGrid } from "./gridDraft";
import { playbackTime } from "../player/playerStore";
import { useGridMutations } from "./api";
import type { useGridDraft } from "./gridDraft";
import { useMetronome } from "./metronome";
import type { Player } from "./usePlayer";
import { WaveformView } from "./WaveformView";

const ZOOMS = ["2", "8", "32"] as const;
type Zoom = (typeof ZOOMS)[number];
const TAP_RESET = 2; // seconds without a tap start a new measurement

const btn =
  "flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm border border-border bg-surface-3 px-2.5 text-control text-text hover:border-border-strong disabled:opacity-40 disabled:hover:border-border";
const icon =
  "grid size-8 shrink-0 place-items-center rounded-sm border border-border bg-surface-3 text-text hover:border-border-strong disabled:opacity-40";

export function GridEditor({
  track,
  player,
  waveform,
  draft,
  onClose,
}: {
  track: TrackDetail;
  player: Player;
  waveform: WaveformData | undefined;
  draft: ReturnType<typeof useGridDraft>;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const duration = track.duration ?? 0;
  const mutations = useGridMutations(track.id);
  const { history, setHistory, initial } = draft;
  const [zoom, setZoom] = useState<Zoom>("8");
  const [metronome, setMetronome] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  const [taps, setTaps] = useState<number[]>([]);
  const g = history?.present ?? initial;
  const grid = useMemo(() => (g ? toBeatGrid(g, duration) : null), [g, duration]);
  useMetronome(metronome, player.playing, grid, duration);

  const commit = useCallback(
    (next: EditorGrid) =>
      setHistory((h) =>
        h && !sameGrid(h.present, next)
          ? { past: [...h.past.slice(-99), h.present], present: next, future: [] }
          : h,
      ),
    [setHistory],
  );
  const undo = useCallback(
    () =>
      setHistory((h) => {
        const prev = h?.past[h.past.length - 1];
        return h && prev
          ? { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] }
          : h;
      }),
    [setHistory],
  );
  const redo = useCallback(
    () =>
      setHistory((h) => {
        const next = h?.future[0];
        return h && next
          ? { past: [...h.past, h.present], present: next, future: h.future.slice(1) }
          : h;
      }),
    [setHistory],
  );

  const nudge = useCallback((ms: number) => g && commit(shiftGrid(g, ms / 1000)), [g, commit]);
  const downbeatHere = useCallback(
    (at?: number) => g && commit(setDownbeatAt(g, at ?? player.time)),
    [g, commit, player.time],
  );
  const anchorHere = useCallback(() => {
    if (!g) return;
    const next = addAnchor(g, player.time);
    commit(next);
    const added = next.anchors.find((a) => !g.anchors.some((b) => b.beat === a.beat));
    if (added) setSelected(added.beat);
  }, [g, commit, player.time]);
  const removeSelected = useCallback(() => {
    if (g && selected != null) {
      commit(removeAnchor(g, selected));
      setSelected(null);
    }
  }, [g, selected, commit]);
  const tap = useCallback(() => {
    const now = playbackTime();
    setTaps((prev) => {
      const last = prev[prev.length - 1];
      const run = last != null && (now - last > TAP_RESET || now < last) ? [] : prev;
      return [...run, now].slice(-16);
    });
  }, []);
  const proposal = g && player.playing && !g.anchors.length ? tapGrid(g, taps) : null;

  // ---- keyboard: the editor's keys win over the detail view's (capture phase) ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest("input, textarea, select, [role=dialog]")) return;
      const k = { nudge, downbeatHere, anchorHere, removeSelected, tap, undo, redo };
      const mod = e.metaKey || e.ctrlKey;
      let handled = true;
      if (mod && e.key.toLowerCase() === "z") (e.shiftKey ? k.redo : k.undo)();
      else if (mod && e.key.toLowerCase() === "y") k.redo();
      else if (mod || e.altKey) handled = false;
      else if (e.key === "," || e.key === "<") k.nudge(e.shiftKey ? -10 : -1);
      else if (e.key === "." || e.key === ">") k.nudge(e.shiftKey ? 10 : 1);
      else if (e.key.toLowerCase() === "d") k.downbeatHere();
      else if (e.key.toLowerCase() === "a") k.anchorHere();
      else if (e.key.toLowerCase() === "t") k.tap();
      else if (e.key.toLowerCase() === "m") setMetronome((on) => !on);
      else if (e.key === "Delete" || e.key === "Backspace") k.removeSelected();
      else if (e.key === "Escape") onClose();
      else handled = false;
      if (handled) e.preventDefault();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [onClose, nudge, downbeatHere, anchorHere, removeSelected, tap, undo, redo]);

  // What the user is typing in the BPM field (null: show the grid's tempo).
  const [bpmEdit, setBpmEdit] = useState<string | null>(null);

  if (!g || !grid || !history) return null;

  const span = Number(zoom);
  const start = Math.min(Math.max(0, player.time - span / 2), Math.max(0, duration - span));
  const view = { start, end: Math.min(duration, start + span) };
  const lines = {
    beats: beatTimes(grid, duration).filter((b) => b >= view.start - 1 && b <= view.end + 1),
    downbeats: downbeatTimes(grid, duration),
  };
  const variable = g.anchors.length > 0;
  const changed = initial ? !sameGrid(initial, g) : true;
  const offsetMs = initial ? Math.round((g.firstDownbeat - initial.firstDownbeat) * 1000) : 0;
  const num = (n: number, digits = 2) =>
    new Intl.NumberFormat(i18n.language, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(n);

  const applyBpm = () => {
    const value = Number((bpmEdit ?? "").replace(",", "."));
    if (bpmEdit != null && Number.isFinite(value) && value >= MIN_BPM && value <= MAX_BPM)
      commit(setBpm(g, value));
    setBpmEdit(null);
  };

  const save = () =>
    mutations.save.mutate(toSpec(g), {
      onSuccess: (result) => {
        onClose();
        const toast = useToastStore.getState();
        if (result.offBeat.length) {
          toast.push({
            title: t("grid.offBeat", { count: result.offBeat.length }),
            tone: "warning",
            action: {
              label: t("grid.snapCues"),
              run: () => mutations.snapCues.mutate(result.offBeat),
            },
          });
        } else {
          toast.push({ title: t("grid.saved"), tone: "success" });
        }
      },
    });

  return (
    <section
      aria-label={t("grid.title")}
      className="flex flex-col gap-3 rounded-md border border-border bg-surface-2 p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-section">{t("grid.title")}</h2>
        <span className="text-[12px] text-text-3">{t("grid.hint")}</span>
        <div className="ml-auto">
          <Segmented
            size="sm"
            label={t("grid.zoom")}
            value={zoom}
            onChange={setZoom}
            options={ZOOMS.map((z) => ({ value: z, label: t("grid.seconds", { n: z }) }))}
          />
        </div>
      </div>

      <WaveformView
        waveform={waveform}
        duration={duration}
        time={player.time}
        energy={[]}
        segments={track.segments ?? []}
        cues={track.cues ?? []}
        grid={grid}
        view={view}
        beatLines={lines}
        anchors={g.anchors}
        selectedAnchor={selected}
        onSelectAnchor={setSelected}
        onMoveAnchor={(beat, time) => commit(moveAnchor(g, beat, time))}
        onSeek={player.seek}
        onDoubleClick={(time) => downbeatHere(time)}
        height={96}
        sectionLabels={false}
        label={t("grid.zoomed")}
      />

      {/* Downbeat, nudge and tempo. */}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btn} onClick={() => downbeatHere()}>
          <Crosshair aria-hidden size={14} strokeWidth={1.5} />
          {t("grid.downbeatHere")}
          <kbd className="font-mono text-[11px] text-text-3">D</kbd>
        </button>
        <div role="group" aria-label={t("grid.nudge")} className="flex items-center gap-1">
          {[-10, -1, 1, 10].map((ms) => (
            <button
              key={ms}
              type="button"
              className={`${btn} px-2 font-mono tabular`}
              aria-label={t("grid.nudgeBy", { ms: ms > 0 ? `+${ms}` : `${ms}` })}
              onClick={() => nudge(ms)}
            >
              {ms > 0 ? <Plus aria-hidden size={12} /> : <Minus aria-hidden size={12} />}
              {Math.abs(ms)} ms
            </button>
          ))}
          <span className="ml-1 font-mono text-[12px] tabular text-text-3" aria-live="polite">
            {offsetMs !== 0 && t("grid.offset", { ms: offsetMs > 0 ? `+${offsetMs}` : offsetMs })}
          </span>
        </div>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <label className="flex items-center gap-2 text-control text-text-2">
          {t("grid.bpm")}
          <input
            value={bpmEdit ?? formatBpm(g.bpm, 2)}
            disabled={variable}
            inputMode="decimal"
            onChange={(e) => setBpmEdit(e.target.value)}
            onBlur={applyBpm}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyBpm();
            }}
            title={variable ? t("grid.bpmVariable") : undefined}
            className="h-8 w-[84px] rounded-sm border border-border bg-surface-3 px-2 text-right font-mono tabular text-text focus:border-primary disabled:opacity-40"
          />
        </label>
        <button type="button" className={btn} onClick={() => commit(doubleTempo(g))}>
          ×2
        </button>
        <button type="button" className={btn} onClick={() => commit(halveTempo(g))}>
          ÷2
        </button>
        <button
          type="button"
          className={btn}
          onClick={tap}
          disabled={variable || !player.playing}
          title={player.playing ? undefined : t("grid.tapNeedsPlay")}
        >
          <Hand aria-hidden size={14} strokeWidth={1.5} />
          {t("grid.tap")}
          <kbd className="font-mono text-[11px] text-text-3">T</kbd>
        </button>
        {proposal && (
          <button
            type="button"
            className={`${btn} border-primary/60`}
            onClick={() => {
              commit(proposal);
              setTaps([]);
            }}
          >
            {t("grid.useTap", { bpm: num(proposal.bpm) })}
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Metronome aria-hidden size={16} strokeWidth={1.5} className="text-text-2" />
          <Switch checked={metronome} onChange={setMetronome} label={t("grid.metronome")} />
        </div>
      </div>

      {/* Anchors, history and saving. */}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btn} onClick={anchorHere}>
          <Anchor aria-hidden size={14} strokeWidth={1.5} />
          {t("grid.addAnchor")}
          <kbd className="font-mono text-[11px] text-text-3">A</kbd>
        </button>
        <button type="button" className={btn} onClick={removeSelected} disabled={selected == null}>
          <Trash2 aria-hidden size={14} strokeWidth={1.5} />
          {t("grid.removeAnchor")}
        </button>
        <span className="text-[12px] text-text-3">
          {variable
            ? t("grid.anchors", { count: g.anchors.length, bpm: num(grid.bpm) })
            : t("grid.constant")}
        </span>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <button
          type="button"
          className={icon}
          aria-label={t("grid.undo")}
          title={`${t("grid.undo")} (${MOD}Z)`}
          onClick={undo}
          disabled={!history.past.length}
        >
          <Undo2 size={16} strokeWidth={1.5} />
        </button>
        <button
          type="button"
          className={icon}
          aria-label={t("grid.redo")}
          title={`${t("grid.redo")} (⇧${MOD}Z)`}
          onClick={redo}
          disabled={!history.future.length}
        >
          <Redo2 size={16} strokeWidth={1.5} />
        </button>
        <div className="ml-auto flex items-center gap-2">
          {(track.gridSource ?? "auto") !== "auto" && (
            <button
              type="button"
              className={btn}
              onClick={() => mutations.reset.mutate(undefined, { onSuccess: onClose })}
            >
              <RotateCcw aria-hidden size={14} strokeWidth={1.5} />
              {t("grid.reset")}
            </button>
          )}
          <button type="button" className={btn} onClick={onClose}>
            {t("grid.cancel")}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!changed || mutations.save.isPending}
            className="flex h-8 items-center rounded-sm bg-primary px-3 font-semibold text-white hover:bg-primary-hover disabled:opacity-40"
          >
            {t("grid.save")}
          </button>
        </div>
      </div>
      <p className="text-[12px] text-text-3">{t("grid.keys", { mod: MOD })}</p>
    </section>
  );
}
