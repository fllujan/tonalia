// "Clean tags" tab (DESIGN 6.7, SPEC 2.10): switchable rules with an example each, the
// editable list of promotional phrases and the preview.
import { X } from "lucide-react";
import { type FormEvent, useDeferredValue, useState } from "react";
import { useTranslation } from "react-i18next";
import { Switch } from "../../components/Switch";
import type { CleanRules } from "../../lib/rpc.types";
import { startClean, useCleanPreview } from "./api";
import { PreviewPane } from "./PreviewPane";
import { reportFailure } from "./reportFailure";

const DEFAULT_RULES: Required<CleanRules> = {
  removeUrls: true,
  removePromo: true,
  promoPhrases: [
    "Free Download",
    "Free DL",
    "Exclusive",
    "Promo Only",
    "Promo",
    "Out Now",
    "Buy on Beatport",
    "Support",
    "Preview",
  ],
  removeTrackNumbers: true,
  removeOriginalMix: false,
  collapseSpaces: true,
  fixCaps: true,
  normalizeFeat: true,
  featPosition: "title",
  unifySeparators: false,
  artistSeparator: ", ",
};

type Rules = Required<CleanRules>;
type Toggle =
  | "removeUrls"
  | "removePromo"
  | "removeTrackNumbers"
  | "removeOriginalMix"
  | "collapseSpaces"
  | "fixCaps"
  | "normalizeFeat"
  | "unifySeparators";

const RULES: Toggle[] = [
  "removeUrls",
  "removePromo",
  "removeTrackNumbers",
  "removeOriginalMix",
  "collapseSpaces",
  "fixCaps",
  "normalizeFeat",
  "unifySeparators",
];
const SEPARATORS = [", ", " & ", "; ", " / "] as const;

export function CleanPanel({ trackIds }: { trackIds: number[] }) {
  const { t } = useTranslation();
  const [rules, setRules] = useState<Rules>(DEFAULT_RULES);
  const [phrase, setPhrase] = useState("");
  const deferred = useDeferredValue(rules);
  const preview = useCleanPreview(trackIds, deferred);
  const set = <K extends keyof Rules>(key: K, value: Rules[K]) =>
    setRules((r) => ({ ...r, [key]: value }));

  const addPhrase = (e: FormEvent) => {
    e.preventDefault();
    const text = phrase.trim();
    if (text && !rules.promoPhrases.some((p) => p.toLowerCase() === text.toLowerCase())) {
      set("promoPhrases", [...rules.promoPhrases, text]);
    }
    setPhrase("");
  };

  return (
    <>
      <aside className="flex w-[360px] shrink-0 flex-col gap-4 overflow-auto border-r border-border p-5">
        <h2 className="text-section">{t("clean.rules")}</h2>
        {RULES.map((rule) => (
          <div key={rule} className="flex flex-col gap-1">
            <Switch
              label={t(`clean.${rule}`)}
              checked={rules[rule]}
              onChange={(v) => set(rule, v)}
            />
            <p className="text-[12px] text-text-3">{t(`clean.examples.${rule}`)}</p>
            {rule === "removePromo" && rules.removePromo && (
              <div className="mt-1 flex flex-col gap-2">
                <ul className="flex flex-wrap gap-1.5" aria-label={t("clean.phrases")}>
                  {rules.promoPhrases.map((p) => (
                    <li
                      key={p}
                      className="flex h-6 items-center gap-1 rounded-pill border border-border bg-surface-2 pl-2 pr-1 text-[12px]"
                    >
                      {p}
                      <button
                        type="button"
                        aria-label={t("clean.removePhrase", { phrase: p })}
                        onClick={() =>
                          set(
                            "promoPhrases",
                            rules.promoPhrases.filter((x) => x !== p),
                          )
                        }
                        className="grid size-4 place-items-center rounded-pill text-text-3 hover:bg-surface-3 hover:text-text"
                      >
                        <X size={10} strokeWidth={2} />
                      </button>
                    </li>
                  ))}
                </ul>
                <form onSubmit={addPhrase} className="flex gap-1.5">
                  <input
                    aria-label={t("clean.newPhrase")}
                    placeholder={t("clean.newPhrase")}
                    value={phrase}
                    maxLength={80}
                    onChange={(e) => setPhrase(e.target.value)}
                    className="h-7 min-w-0 flex-1 rounded-sm border border-border bg-surface-3 px-2 text-control text-text outline-none focus:border-primary"
                  />
                  <button
                    type="submit"
                    className="h-7 rounded-sm border border-border bg-surface-3 px-2 text-control text-text"
                  >
                    {t("clean.add")}
                  </button>
                </form>
              </div>
            )}
            {rule === "normalizeFeat" && rules.normalizeFeat && (
              <select
                aria-label={t("clean.featPosition")}
                value={rules.featPosition}
                onChange={(e) => set("featPosition", e.target.value as Rules["featPosition"])}
                className="mt-1 h-7 rounded-sm border border-border bg-surface-3 px-2 text-control text-text"
              >
                {(["title", "artist", "keep"] as const).map((p) => (
                  <option key={p} value={p}>
                    {t(`clean.featPositions.${p}`)}
                  </option>
                ))}
              </select>
            )}
            {rule === "unifySeparators" && rules.unifySeparators && (
              <select
                aria-label={t("clean.separator")}
                value={rules.artistSeparator}
                onChange={(e) => set("artistSeparator", e.target.value as Rules["artistSeparator"])}
                className="mt-1 h-7 rounded-sm border border-border bg-surface-3 px-2 font-mono text-control text-text"
              >
                {SEPARATORS.map((s) => (
                  <option key={s} value={s}>
                    {`A${s}B`}
                  </option>
                ))}
              </select>
            )}
          </div>
        ))}
      </aside>
      <PreviewPane
        preview={preview.data}
        fetching={preview.isFetching}
        total={trackIds.length}
        onWrite={() => void startClean(trackIds, rules).catch(reportFailure(t))}
      />
    </>
  );
}
