import type { TFunction } from "i18next";
import { useToastStore } from "../toast/toastStore";

export const reportFailure = (t: TFunction) => (err: unknown) =>
  useToastStore.getState().push({
    title: t("tags.failed", { error: err instanceof Error ? err.message : String(err) }),
    tone: "danger",
  });
