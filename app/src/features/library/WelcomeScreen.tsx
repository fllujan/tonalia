import { ArrowRight, AudioLines, Disc3, FolderOpen, Layers } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LogoMark } from "../../components/brand/Logo";

// DESIGN.md 6.1 — first run: big drop zone over an aurora halo.
const STEPS = [
  { icon: AudioLines, color: "text-cue-1", title: "analyze", text: "analyzeText" },
  { icon: Layers, color: "text-cue-5", title: "organize", text: "organizeText" },
  { icon: Disc3, color: "text-accent", title: "mix", text: "mixText" },
] as const;

export function WelcomeScreen({
  dragging,
  onChooseFolder,
}: {
  dragging: boolean;
  onChooseFolder: () => void;
}) {
  const { t } = useTranslation();
  return (
    <section
      data-tauri-drag-region
      className="relative flex flex-1 flex-col items-center overflow-hidden bg-bg"
      aria-labelledby="welcome-title"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-16 left-1/2 h-[520px] w-[720px] -translate-x-1/2 rounded-pill bg-aurora opacity-25 blur-[130px]"
      />
      <div className="relative z-10 flex w-full max-w-[780px] flex-col items-center px-6 pt-[88px]">
        <LogoMark size={120} spinning />
        <h1 id="welcome-title" className="mt-8 font-display text-display tracking-[-0.01em]">
          {t("welcome.title")}
        </h1>
        <p className="mt-1.5 text-section font-normal text-text-2">{t("app.tagline")}</p>

        <div
          className={`mt-10 flex h-[232px] w-full flex-col items-center justify-center gap-3.5 rounded-lg border-2 border-dashed transition-colors duration-hover ${dragging ? "border-primary bg-primary-soft" : "border-border-strong bg-surface-1/40"}`}
        >
          <div className="grid size-[52px] place-items-center rounded-pill border border-border bg-surface-3 text-text">
            <FolderOpen size={24} strokeWidth={1.5} />
          </div>
          <div className="text-center">
            <div className="text-section">{t("welcome.dropTitle")}</div>
            <div className="mt-0.5 text-[12px] text-text-3">{t("welcome.dropHint")}</div>
          </div>
          <button
            type="button"
            onClick={onChooseFolder}
            className="h-8 rounded-sm border border-border-strong bg-surface-3 px-3.5 font-medium text-text transition-colors duration-hover hover:bg-surface-2"
          >
            {t("welcome.chooseFolder")}
          </button>
        </div>

        <ol className="mt-12 grid w-full grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)_24px_minmax(0,1fr)] items-start gap-4">
          {STEPS.map((step, i) => (
            <li key={step.title} className="contents">
              {i > 0 && (
                <span aria-hidden className="flex justify-center pt-2 text-text-3">
                  <ArrowRight size={16} strokeWidth={1.5} />
                </span>
              )}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2.5">
                  <span
                    className={`grid size-8 place-items-center rounded-[8px] border border-border bg-surface-2 ${step.color}`}
                  >
                    <step.icon size={16} strokeWidth={1.5} />
                  </span>
                  <span className="font-mono text-[11px] text-text-3">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                </div>
                <div className="text-section">{t(`welcome.steps.${step.title}`)}</div>
                <div className="text-text-2">{t(`welcome.steps.${step.text}`)}</div>
              </div>
            </li>
          ))}
        </ol>
      </div>
      <p className="absolute inset-x-0 bottom-6 text-center text-[12px] text-text-3">
        {t("footer")}
      </p>
    </section>
  );
}
