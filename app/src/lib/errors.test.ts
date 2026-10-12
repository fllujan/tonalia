import i18n from "../i18n";
import { describeMessage, errorDetail, errorMessage } from "./errors";
import { RpcError } from "./rpc";

beforeAll(() => i18n.changeLanguage("es"));

// Messages exactly as the engine raises them (grep `raise .*Error(` in engine/).
const ENGINE: readonly (readonly [string, RegExp])[] = [
  ["unknown track 42", /ya no está en la biblioteca/],
  ["unknown tracks [3, 4]", /ya no está en la biblioteca/],
  ["unknown playlist 7", /playlist ya no existe/],
  ["unknown favorite 2", /favorito ya no existe/],
  ["unknown batch abc", /ya no se puede deshacer/],
  ["the stems of this track are not separated yet", /«Separar stems»/],
  ["the htdemucs_ft model is not downloaded", /Ajustes → Stems/],
  ["htdemucs.th: checksum mismatch, the download is corrupt", /dañada/],
  ["Traktor is open: close it before exporting", /Traktor está abierto/],
  ["VirtualDJ is open: close it before exporting", /VirtualDJ está abierto/],
  ["Noche (vocals) [8A 124].wav already exists", /«Noche \(vocals\) \[8A 124\]\.wav»/],
  ["the folder /Volumes/USB does not exist", /«\/Volumes\/USB» no existe/],
  ["file not found: /Música/tema.mp3", /se haya movido o borrado/],
  ["cannot decode tema 🌙.flac: Invalid data found", /«tema 🌙\.flac»/],
  ["no audio stream in portada.mp3", /«portada\.mp3» no contiene audio/],
  ["FFmpeg not found (set TONALIA_FFMPEG or run scripts/fetch-binaries)", /FFmpeg/],
  ["Rubber Band failed: bad option", /Rubber Band/],
  ["90 → 200 BPM is out of range (half to double)", /entre la mitad y el doble/],
  ["the pool has no analysed tracks", /no tiene temas analizados/],
  ["the track is not analysed yet (it needs a key and a BPM)", /Analízalo primero/],
  ["the track has no tempo yet: analyse it before changing its tempo", /Analízalo primero/],
  ["choose a destination folder or set the DAW folder", /carpeta del DAW/],
  ["the name cannot be empty", /no puede estar vacío/],
  ["verification failed for key, bpm", /no se ha modificado/],
  ["the file has changed since Tonalia wrote it", /ha cambiado/],
  ["backup does not match the original file", /copia de seguridad no corresponde/],
  ["writing tags to .wma files is not supported", /no es compatible/],
  ["Serato tags are not supported in .wav files", /no es compatible/],
  ["only .m3u and .m3u8 playlists can be imported", /\.m3u8/],
  ["folders cannot be exported", /elige una playlist/],
  ["a folder cannot be moved inside itself", /dentro de sí misma/],
  ["a favorite needs two different tracks", /dos temas distintos/],
  ["cannot read lista.m3u8: Permission denied", /permiso/],
  ["cannot read tags of tema.mp3: bad frame", /«tema\.mp3»/],
  ["invalid params", /no es válido/],
  ["internal error: division by zero", /carpeta de logs/],
];

describe("clear error messages", () => {
  it.each(ENGINE)("%s", (message, expected) => {
    expect(describeMessage(message)).toMatch(expected);
    expect(errorMessage(new RpcError(-32602, message))).toMatch(expected);
  });

  it("explains the bridge's own errors by code", () => {
    expect(errorMessage(new RpcError(-32000, "engine is not running"))).toMatch(/arrancando/);
    expect(errorMessage(new RpcError(-32001, "engine exited"))).toMatch(/Se reinicia solo/);
    expect(errorMessage(new RpcError(-32002, "timed out"))).toMatch(/tarda demasiado/);
    expect(errorMessage(new RpcError(-32601, "method not found: x.y"))).toMatch(/Reinstala/);
  });

  it("keeps unknown messages as they are and gives the technical text as detail", () => {
    expect(errorMessage(new Error("something new"))).toBe("something new");
    expect(errorDetail(new Error("something new"))).toBeUndefined();
    expect(errorMessage("plain string")).toBe("plain string");
    expect(errorDetail(new RpcError(-32602, "unknown track 3"))).toBe("unknown track 3");
  });

  it("speaks English too", async () => {
    await i18n.changeLanguage("en");
    expect(describeMessage("Traktor is open: close it before exporting")).toBe(
      "Traktor is open. Close it and export again.",
    );
    await i18n.changeLanguage("es");
  });
});
