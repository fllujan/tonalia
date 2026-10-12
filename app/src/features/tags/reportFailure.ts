import type { TFunction } from "i18next";
import { useToastStore } from "../toast/toastStore";
import { errorMessage } from "../../lib/errors";

export const reportFailure = (t: TFunction) => (err: unknown) =>
  useToastStore.getState().push({
    title: t("tags.failed", { error: errorMessage(err) }),
    tone: "danger",
  });
