import en from "../i18n/en.json";
import es from "../i18n/es.json";
import i18n from "../i18n";
import {
  describeError,
  describeFailure,
  describeMessage,
  errorDetail,
  errorMessage,
  REASON_KEYS,
} from "./errors";
import { RpcError } from "./rpc";

beforeAll(() => i18n.changeLanguage("es"));

/** An engine error as the bridge passes it on (SPEC 11.4: `data.reason` + `data.detail`). */
const engineError = (reason: string, detail: string, params: Record<string, string> = {}) =>
  new RpcError(-32602, detail, { reason, params, detail });

describe("engine errors, by code", () => {
  it("has an es and en sentence for every code", () => {
    for (const texts of [es, en]) {
      const reasons = texts.errors.reasons as Record<string, string>;
      for (const [reason, key] of Object.entries(REASON_KEYS)) {
        expect(key).toBe(`errors.reasons.${reason}`);
        expect(reasons[reason], reason).toBeTruthy();
      }
      expect(Object.keys(reasons).sort()).toEqual(Object.keys(REASON_KEYS).sort());
    }
  });

  it("fills each sentence with its values", () => {
    expect(
      errorMessage(engineError("program_running", "Traktor is open", { program: "Traktor" })),
    ).toBe("Traktor está abierto. Ciérralo y vuelve a exportar.");
    expect(
      errorMessage(engineError("decode_failed", "cannot decode x", { name: "tema 🌙.flac" })),
    ).toMatch(/«tema 🌙\.flac»/);
    expect(
      errorMessage(engineError("folder_not_found", "the folder…", { folder: "/Volumes/USB" })),
    ).toMatch(/«\/Volumes\/USB» no existe/);
  });

  it("does not depend on the English text", () => {
    expect(errorMessage(engineError("track_not_found", "anything at all"))).toBe(
      "Ese tema ya no está en la biblioteca.",
    );
    expect(errorDetail(engineError("track_not_found", "unknown track 3"))).toBe("unknown track 3");
  });

  it("translates failed jobs, tracks and files by their errorInfo", () => {
    expect(
      describeFailure({ error: "the stems…", errorInfo: { reason: "stems_missing", params: {} } }),
    ).toMatch(/«Separar stems»/);
    expect(describeError({ reason: "disk_full", params: {} }, "No space left")).toBe(
      "No queda espacio en el disco.",
    );
  });

  it("speaks English too", async () => {
    await i18n.changeLanguage("en");
    expect(
      errorMessage(engineError("program_running", "VirtualDJ is open", { program: "VirtualDJ" })),
    ).toBe("VirtualDJ is open. Close it and export again.");
    await i18n.changeLanguage("es");
  });
});

describe("errors from outside the engine", () => {
  it("explains the bridge's own errors by code", () => {
    expect(errorMessage(new RpcError(-32000, "engine is not running"))).toMatch(/arrancando/);
    expect(errorMessage(new RpcError(-32001, "engine exited"))).toMatch(/Se reinicia solo/);
    expect(errorMessage(new RpcError(-32002, "timed out"))).toMatch(/tarda demasiado/);
  });

  it.each([
    ["error sending request for url (https://github.com/…/latest.json)", /Sin conexión/],
    ["Could not fetch a valid release JSON from the remote", /ninguna versión publicada/],
    ["the signature verification failed", /firma válida/],
    ["third-party list not found", /licencias/],
    ["Permission denied (os error 13)", /permiso/],
  ])("%s", (message, expected) => {
    expect(describeMessage(message)).toMatch(expected);
    expect(errorMessage(new Error(message))).toMatch(expected);
  });

  it("keeps unknown messages as they are and gives the technical text as detail", () => {
    expect(errorMessage(new Error("something new"))).toBe("something new");
    expect(errorDetail(new Error("something new"))).toBeUndefined();
    expect(errorMessage("plain string")).toBe("plain string");
  });
});
