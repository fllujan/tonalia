// Ideas for deck B (SPEC 2.15): suggest.mashups / suggest.mixouts. Keyed under the library
// so a new analysis, an edit or a playlist change refreshes them.
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { request } from "../../lib/rpc";
import type { SuggestParams } from "../../lib/rpc.types";
import { libraryKeys } from "../library/api";
import type { ProMode } from "../decks/decksStore";

export const suggestKeys = {
  all: [...libraryKeys.all, "suggest"] as const,
  list: (mode: ProMode, params: SuggestParams) => [...suggestKeys.all, mode, params] as const,
};

export function useSuggestions(mode: ProMode, params: SuggestParams | null) {
  return useQuery({
    queryKey: params ? suggestKeys.list(mode, params) : [...suggestKeys.all, "off"],
    enabled: params != null,
    placeholderData: keepPreviousData,
    queryFn: () =>
      request(mode === "mashup" ? "suggest.mashups" : "suggest.mixouts", params as SuggestParams),
  });
}
