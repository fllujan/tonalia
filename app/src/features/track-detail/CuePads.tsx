// Cue pads (DESIGN 5.10 / 6.5): eight slots; a filled pad jumps to its cue, an empty pad
// (or "Set cue here") stores the playback position snapped to the beat. Each cue can be
// renamed, recoloured or deleted; "Reset automatic" brings back the analysis cues.
import { Crosshair, MoreHorizontal, RotateCcw } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Popover } from "../../components/Popover";
import { formatDuration } from "../../lib/format";
import type { Cue } from "../../lib/rpc.types";
import { CUE_PALETTE } from "../../lib/sections";
import { useCueLabel } from "./cueLabel";

interface CueEditorProps {
  anchor: HTMLElement;
  cue: Cue;
  label: string;
  onSave: (label: string, color: string) => void;
  onDelete: () => void;
  onClose: () => void;
}

function CueEditor({ anchor, cue, label, onSave, onDelete, onClose }: CueEditorProps) {
  const { t } = useTranslation();
  const [text, setText] = useState(label);
  const [color, setColor] = useState(cue.color ?? CUE_PALETTE[cue.slot] ?? "#4CC3FF");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSave(text.trim(), color);
  };
  return (
    <Popover anchor={anchor} label={t("cues.edit", { n: cue.slot + 1 })} onClose={onClose}>
      <form onSubmit={submit} className="flex w-[240px] flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-label uppercase text-text-3">{t("cues.name")}</span>
          <input
            data-autofocus
            value={text}
            maxLength={64}
            onChange={(e) => setText(e.target.value)}
            className="h-8 rounded-sm border border-border bg-surface-3 px-2 text-control text-text outline-none focus:border-primary"
          />
        </label>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-label uppercase text-text-3">{t("cues.color")}</legend>
          <div className="flex flex-wrap gap-1.5">
            {CUE_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                aria-pressed={c.toLowerCase() === color.toLowerCase()}
                onClick={() => setColor(c)}
                className={`size-6 rounded-pill ${c.toLowerCase() === color.toLowerCase() ? "ring-2 ring-primary ring-offset-2 ring-offset-surface-1" : ""}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </fieldset>
        <div className="flex justify-between gap-2">
          <button
            type="button"
            onClick={onDelete}
            className="h-7 rounded-sm px-2 text-control text-danger hover:bg-surface-3"
          >
            {t("cues.delete")}
          </button>
          <button
            type="submit"
            className="h-7 rounded-sm bg-primary px-3 text-control font-semibold text-white hover:bg-primary-hover"
          >
            {t("edit.save")}
          </button>
        </div>
      </form>
    </Popover>
  );
}

interface CuePadsProps {
  cues: Cue[];
  time: number;
  snap: (time: number) => number;
  onJump: (cue: Cue) => void;
  onSet: (slot: number, position: number, label: string | null, color: string | null) => void;
  onDelete: (slot: number) => void;
  onReset: () => void;
}

export function CuePads({ cues, time, snap, onJump, onSet, onDelete, onReset }: CuePadsProps) {
  const { t } = useTranslation();
  const labelOf = useCueLabel();
  const [editing, setEditing] = useState<{ cue: Cue; anchor: HTMLElement } | null>(null);
  const [confirm, setConfirm] = useState<HTMLElement | null>(null);
  const bySlot = new Map(cues.map((c) => [c.slot, c]));
  const free = [...Array(8).keys()].find((s) => !bySlot.has(s));

  const setHere = (slot: number) => onSet(slot, snap(time), null, CUE_PALETTE[slot] ?? null);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h2 className="text-section">{t("cues.title")}</h2>
        <div className="flex-1" />
        <button
          type="button"
          disabled={free === undefined}
          title={free === undefined ? t("cues.full") : undefined}
          onClick={() => free !== undefined && setHere(free)}
          className="flex h-7 items-center gap-1.5 rounded-sm border border-border bg-surface-3 px-2.5 text-control text-text disabled:opacity-40"
        >
          <Crosshair size={14} strokeWidth={1.5} />
          {t("cues.snap")}
        </button>
        <button
          type="button"
          onClick={(e) => setConfirm(e.currentTarget)}
          className="flex h-7 items-center gap-1.5 rounded-sm px-2 text-control text-text-2 hover:bg-surface-3 hover:text-text"
        >
          <RotateCcw size={14} strokeWidth={1.5} />
          {t("cues.reset")}
        </button>
      </div>
      <div className="grid grid-cols-8 gap-2" role="group" aria-label={t("cues.title")}>
        {[...Array(8).keys()].map((slot) => {
          const cue = bySlot.get(slot);
          if (!cue) {
            return (
              <button
                key={slot}
                type="button"
                aria-label={t("cues.emptyPad", { n: slot + 1 })}
                onClick={() => setHere(slot)}
                className="flex h-14 flex-col justify-between rounded-md border border-dashed border-border-strong p-2 text-left text-text-3 hover:border-primary hover:text-text"
              >
                <span className="font-mono text-[11px]">{slot + 1}</span>
                <span className="text-[11px]">{t("cues.empty")}</span>
              </button>
            );
          }
          const color = cue.color ?? `var(--color-cue-${slot + 1})`;
          const label = labelOf(cue);
          return (
            <div
              key={slot}
              className="group relative flex h-14 overflow-hidden rounded-md border border-border bg-surface-2"
            >
              <button
                type="button"
                aria-label={t("cues.pad", {
                  n: slot + 1,
                  label: label || t("cues.unnamed"),
                  time: formatDuration(cue.positionSec),
                })}
                onClick={() => onJump(cue)}
                className="flex min-w-0 flex-1 flex-col justify-between p-2 text-left hover:bg-surface-3"
              >
                <span className="flex items-center gap-1.5 font-mono text-[11px] text-text-2">
                  {/* Same numbered flag as on the waveform, so pad and marker read as one. */}
                  <span
                    aria-hidden
                    className="grid size-4 place-items-center rounded-[3px] text-[10px] font-semibold text-on-key"
                    style={{ backgroundColor: color }}
                  >
                    {slot + 1}
                  </span>
                  {formatDuration(cue.positionSec)}
                </span>
                <span className="truncate text-[12px] font-medium">
                  {label || t("cues.unnamed")}
                </span>
              </button>
              <button
                type="button"
                aria-label={t("cues.edit", { n: slot + 1 })}
                onClick={(e) => setEditing({ cue, anchor: e.currentTarget })}
                className="absolute right-1 top-1 grid size-5 place-items-center rounded-sm text-text-3 hover:bg-surface-3 hover:text-text"
              >
                <MoreHorizontal size={14} strokeWidth={1.5} />
              </button>
            </div>
          );
        })}
      </div>
      {editing && (
        <CueEditor
          anchor={editing.anchor}
          cue={editing.cue}
          label={labelOf(editing.cue)}
          onClose={() => setEditing(null)}
          onDelete={() => {
            onDelete(editing.cue.slot);
            setEditing(null);
          }}
          onSave={(label, color) => {
            onSet(editing.cue.slot, editing.cue.positionSec, label || null, color);
            setEditing(null);
          }}
        />
      )}
      {confirm && (
        <Popover anchor={confirm} label={t("cues.reset")} onClose={() => setConfirm(null)}>
          <div className="flex w-[260px] flex-col gap-3">
            <p className="text-body text-text-2">{t("cues.resetConfirm")}</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirm(null)}
                className="h-7 rounded-sm px-2 text-control text-text-2 hover:text-text"
              >
                {t("edit.cancel")}
              </button>
              <button
                type="button"
                onClick={() => {
                  onReset();
                  setConfirm(null);
                }}
                className="h-7 rounded-sm bg-danger-fill px-3 text-control font-semibold text-white"
              >
                {t("cues.resetAction")}
              </button>
            </div>
          </div>
        </Popover>
      )}
    </div>
  );
}
