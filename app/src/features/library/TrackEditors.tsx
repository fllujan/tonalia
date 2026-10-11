// Manual key / BPM edits from the library table (SPEC 2.14: they prevail over analysis).
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyChip } from "../../components/KeyChip";
import { Popover } from "../../components/Popover";
import { formatKey, fromWheel, type Key, type Notation } from "../../lib/keys";
import { keyColor } from "../../lib/keyStyle";

const WHEEL = Array.from({ length: 12 }, (_, i) => i + 1);

interface KeyEditorProps {
  anchor: HTMLElement;
  current: Key | null;
  notation: Notation;
  onSave: (key: Key | null) => void;
  onClose: () => void;
}

/** 24-key grid ordered by the harmonic wheel: minor (A) row above, major (B) below. */
export function KeyEditor({ anchor, current, notation, onSave, onClose }: KeyEditorProps) {
  const { t } = useTranslation();
  return (
    <Popover anchor={anchor} label={t("edit.keyTitle")} onClose={onClose}>
      <div className="mb-2 text-label uppercase text-text-3">{t("edit.keyTitle")}</div>
      <div className="grid grid-cols-12 gap-1.5" role="group" aria-label={t("edit.keyTitle")}>
        {(["A", "B"] as const).flatMap((letter) =>
          WHEEL.map((n) => {
            const key = fromWheel(n, letter);
            const selected = current?.root === key.root && current.mode === key.mode;
            return (
              <button
                key={`${n}${letter}`}
                type="button"
                aria-pressed={selected}
                data-autofocus={selected || undefined}
                aria-label={`${formatKey(key, notation)} (${t(`key.mode.${key.mode}`)})`}
                onClick={() => onSave(key)}
                style={selected ? { outlineColor: keyColor(key) } : undefined}
                className={`rounded-pill ${selected ? "outline outline-2 outline-offset-2" : ""}`}
              >
                <KeyChip musicalKey={key} notation={notation} />
              </button>
            );
          }),
        )}
      </div>
      <div className="mt-3 flex justify-between gap-2">
        <button
          type="button"
          onClick={() => onSave(null)}
          className="h-7 rounded-sm px-2 text-control text-text-2 hover:bg-surface-3 hover:text-text"
        >
          {t("edit.noKey")}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="h-7 rounded-sm border border-border bg-surface-3 px-3 text-control text-text"
        >
          {t("edit.cancel")}
        </button>
      </div>
    </Popover>
  );
}

interface BpmEditorProps {
  anchor: HTMLElement;
  current: number | null;
  onSave: (bpm: number | null) => void;
  onClose: () => void;
}

/** Numeric BPM input with ×2 / ÷2 (the usual octave fixes). */
export function BpmEditor({ anchor, current, onSave, onClose }: BpmEditorProps) {
  const { t } = useTranslation();
  const [text, setText] = useState(current == null ? "" : String(Number(current.toFixed(2))));
  const value = Number(text.replace(",", "."));
  const valid = text.trim() !== "" && Number.isFinite(value) && value > 0 && value <= 400;

  const scale = (factor: number) => {
    if (valid) setText(String(Number((value * factor).toFixed(2))));
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) onSave(Number(value.toFixed(3)));
  };

  return (
    <Popover anchor={anchor} label={t("edit.bpmTitle")} onClose={onClose}>
      <form onSubmit={submit} className="flex w-[220px] flex-col gap-2.5">
        <label className="flex flex-col gap-1">
          <span className="text-label uppercase text-text-3">{t("edit.bpmTitle")}</span>
          <input
            data-autofocus
            inputMode="decimal"
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-invalid={!valid}
            className="h-8 rounded-sm border border-border bg-surface-3 px-2 font-mono text-data text-text outline-none focus:border-primary aria-[invalid=true]:border-danger"
          />
        </label>
        <div className="flex gap-1.5">
          {[
            { factor: 2, label: "×2", aria: t("edit.double") },
            { factor: 0.5, label: "÷2", aria: t("edit.half") },
          ].map(({ factor, label, aria }) => (
            <button
              key={label}
              type="button"
              aria-label={aria}
              disabled={!valid}
              onClick={() => scale(factor)}
              className="h-7 flex-1 rounded-sm border border-border bg-surface-3 font-mono text-control text-text disabled:opacity-40"
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-7 rounded-sm px-2 text-control text-text-2 hover:text-text"
          >
            {t("edit.cancel")}
          </button>
          <button
            type="submit"
            disabled={!valid}
            className="h-7 rounded-sm bg-primary px-3 text-control font-semibold text-white hover:bg-primary-hover disabled:opacity-40"
          >
            {t("edit.save")}
          </button>
        </div>
      </form>
    </Popover>
  );
}
