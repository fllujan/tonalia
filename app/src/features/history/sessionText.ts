// How a play session is named (SPEC 13.4): its own name, or the day it was played.
import type { TFunction } from "i18next";
import type { PlaySession } from "../../lib/rpc.types";
import { IMPORT_SOURCES } from "../dj-import/importJobs";

/** "vie, 3 oct 2026, 22:15" in the UI language (or the day only, for a whole day). */
export function sessionDate(session: PlaySession, locale: string): string {
  const at = new Date(session.startedAt);
  if (Number.isNaN(at.getTime())) return session.startedAt;
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(at.getHours() || at.getMinutes() ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(at);
}

/** Where it comes from: the program, or "Marcado a mano". */
export function sessionSource(session: PlaySession, t: TFunction): string {
  if (session.program == null) return t("history.manual");
  return IMPORT_SOURCES.find((s) => s.source === session.program)?.title ?? session.program;
}

export function sessionTitle(session: PlaySession | null, t: TFunction, locale: string): string {
  if (!session) return t("history.title");
  return session.name || sessionDate(session, locale);
}
