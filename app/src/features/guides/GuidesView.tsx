// Built-in guides (SPEC 2.14 and 6.3, DESIGN 6.14): an index on the left and the article
// on the right. The texts live in the i18n files (es/en); example keys are written in the
// user's notation.
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatKey, fromAlphanumeric } from "../../lib/keys";
import { useSettings } from "../settings/api";
import { EnergyFigure, PhraseFigure, StemsFigure, WheelFigure } from "./figures";

const GUIDES = ["harmonic", "energy", "cues", "stems"] as const;
type Guide = (typeof GUIDES)[number];

interface Section {
  heading: string;
  body: string[];
}

const EXAMPLE_KEYS = ["8A", "7A", "9A", "8B", "9B", "10A", "3A"] as const;

export function GuidesView() {
  const { t } = useTranslation();
  const { notation } = useSettings();
  const [guide, setGuide] = useState<Guide>("harmonic");
  const keys = Object.fromEntries(
    EXAMPLE_KEYS.map((k) => [`k${k}`, formatKey(fromAlphanumeric(k), notation)]),
  );
  const base = `guides.articles.${guide}`;
  const sections = t(`${base}.sections`, { returnObjects: true }) as Section[];
  const figure: Record<Guide, ReactNode> = {
    harmonic: <WheelFigure notation={notation} />,
    energy: <EnergyFigure />,
    cues: <PhraseFigure />,
    stems: <StemsFigure />,
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-labelledby="guides-title">
      <header
        data-tauri-drag-region
        className="flex h-14 shrink-0 items-center border-b border-border px-5"
      >
        <h1 id="guides-title" className="font-display text-title">
          {t("guides.title")}
        </h1>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label={t("guides.contents")}
          className="flex w-[240px] shrink-0 flex-col gap-0.5 border-r border-border p-3"
        >
          {GUIDES.map((g) => (
            <button
              key={g}
              type="button"
              aria-current={g === guide ? "page" : undefined}
              onClick={() => setGuide(g)}
              className={`rounded-sm px-3 py-2 text-left transition-colors duration-hover ${g === guide ? "bg-primary-soft text-text" : "text-text-2 hover:bg-surface-2 hover:text-text"}`}
            >
              {t(`guides.articles.${g}.title`)}
            </button>
          ))}
        </nav>
        <article key={guide} className="min-h-0 flex-1 overflow-auto px-8 py-6">
          <div className="flex max-w-[720px] flex-col gap-5">
            <h2 className="font-display text-title">{t(`${base}.title`)}</h2>
            <p className="text-[15px] leading-[24px] text-text-2">{t(`${base}.lead`, keys)}</p>
            {figure[guide]}
            {sections.map((section, i) => (
              <section key={section.heading} className="flex flex-col gap-2">
                <h3 className="text-section">{t(`${base}.sections.${i}.heading`)}</h3>
                {section.body.map((_, j) => (
                  <p key={j} className="text-body text-text-2">
                    {t(`${base}.sections.${i}.body.${j}`, keys)}
                  </p>
                ))}
              </section>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}
