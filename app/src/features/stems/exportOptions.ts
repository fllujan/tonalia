// Choices of the stem export (SPEC 2.16), shared by the dialog and the settings.
import type { StemExportItem, StemExportParams } from "../../lib/rpc.types";

export type RenderSource = NonNullable<StemExportItem["source"]>;
export type StemExportFormat = NonNullable<StemExportParams["format"]>;

export const EXPORT_SOURCES: readonly RenderSource[] = [
  "mix",
  "vocals",
  "instrumental",
  "drums",
  "bass",
  "other",
];
export const EXPORT_FORMATS: readonly StemExportFormat[] = ["wav", "aiff", "flac"];
