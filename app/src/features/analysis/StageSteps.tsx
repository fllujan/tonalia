// Per-track stage stepper of the Analyse view (DESIGN 6.4): one dot per engine stage
// (decoding → key → tempo → energy → structure → quality → waveform), the finished ones
// lit, the current one pulsing, with the stage written next to it so nothing relies on
// the dots alone.
import { useTranslation } from "react-i18next";
import type { TrackSummary } from "../../lib/rpc.types";
import { ANALYSIS_STAGES, useAnalysisStore } from "../library/analysisStore";

export function StageSteps({ track }: { track: TrackSummary }) {
  const { t } = useTranslation();
  // The store hears each stage live; the row's status only changes on the next table
  // refresh, so a pending row the job has already picked up shows its stage too.
  const stage = useAnalysisStore((s) =>
    track.status === "analyzing" || track.status === "pending" ? s.stages[track.id] : undefined,
  );
  // "Analyzing" with no job running is a stale row (the engine puts such tracks back to
  // pending when it starts), so it reads as pending rather than stuck.
  const running = useAnalysisStore((s) => s.jobId !== null);
  const status = track.status === "analyzing" && !running ? "pending" : track.status;
  const current = stage ? ANALYSIS_STAGES.indexOf(stage) : -1;
  const text = stage ? t(`library.stages.${stage}`) : t(`library.status.${status}`);
  const label = stage
    ? t("analysis.stageStep", {
        stage: text,
        step: current + 1,
        steps: ANALYSIS_STAGES.length,
      })
    : text;
  return (
    <span role="img" aria-label={label} title={label} className="flex items-center gap-2">
      <span aria-hidden className="flex items-center gap-[3px]">
        {ANALYSIS_STAGES.map((s, i) => (
          <span
            key={s}
            data-step={i < current ? "done" : i === current ? "current" : "todo"}
            className={`size-1.5 rounded-pill ${
              i < current
                ? "bg-primary-ink"
                : i === current
                  ? "bg-primary-ink ring-2 ring-primary/40 motion-safe:animate-pulse"
                  : "bg-surface-3"
            }`}
          />
        ))}
      </span>
      <span className={`truncate text-[12px] ${stage ? "text-text" : "text-text-3"}`}>{text}</span>
    </span>
  );
}
