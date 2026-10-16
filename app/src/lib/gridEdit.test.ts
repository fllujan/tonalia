// Beatgrid editor maths (SPEC 12.4), mirrored by engine/tonalia_engine/grid.py.
import { describe, expect, test } from "vitest";
import { beatTimes, downbeatTimes } from "./beats";
import {
  addAnchor,
  doubleTempo,
  editorFromStored,
  halveTempo,
  moveAnchor,
  removeAnchor,
  setDownbeatAt,
  shiftGrid,
  tapGrid,
  timeOfBeat,
  toBeatGrid,
  toSpec,
} from "./gridEdit";

const constant = { bpm: 120, firstDownbeat: 0.25, anchors: [] };

describe("building", () => {
  test("a constant grid is a tempo and a first downbeat", () => {
    expect(toBeatGrid(constant, 60)).toEqual({ kind: "constant", bpm: 120, first_downbeat: 0.25 });
    expect(toSpec(constant)).toEqual({ bpm: 120, firstDownbeat: 0.25, anchors: [] });
  });

  test("anchors pin beats and the beats between them are spread evenly", () => {
    const g = {
      bpm: 120,
      firstDownbeat: 1,
      anchors: [
        { beat: 8, time: 5 },
        { beat: 16, time: 9.2 },
      ],
    };
    const grid = toBeatGrid(g, 20);
    expect(grid.kind).toBe("variable");
    const beats = grid.beats ?? [];
    expect(beats[0]).toBeCloseTo(0);
    expect(beats[2]).toBeCloseTo(1);
    expect(beats[10]).toBeCloseTo(5);
    expect(beats[14]).toBeCloseTo(5 + 4 * 0.525);
    expect(beats[19]).toBeCloseTo(9.725);
    expect(grid.first_downbeat).toBeCloseTo(1);
    expect(downbeatTimes(grid, 20).slice(0, 3)).toEqual([1, 3, 5]);
    expect(timeOfBeat(g, -2)).toBeCloseTo(0);
    expect(timeOfBeat(g, 12)).toBeCloseTo(7.1);
  });

  test("a stored grid opens in the editor: pins come back, an analysed curve gets anchors", () => {
    expect(editorFromStored({ kind: "constant", bpm: 124, first_downbeat: 0.1 })).toEqual({
      bpm: 124,
      firstDownbeat: 0.1,
      anchors: [],
    });
    const drawn = toBeatGrid(
      {
        bpm: 120,
        firstDownbeat: 1,
        anchors: [{ beat: 8, time: 5.1 }],
      },
      30,
    );
    expect(editorFromStored(drawn)).toEqual({
      bpm: drawn.bpm,
      firstDownbeat: 1,
      anchors: [{ beat: 8, time: 5.1 }],
    });
    // A variable grid from the analysis: an anchor every 16 bars keeps its beats.
    const beats = Array.from({ length: 200 }, (_, i) => 0.5 + i * (0.5 + i * 0.0001));
    const analysed = editorFromStored({
      kind: "variable",
      bpm: 118,
      first_downbeat: beats[1] ?? 0,
      beats,
    });
    expect(analysed?.firstDownbeat).toBe(beats[1]);
    expect(analysed?.anchors.map((a) => a.beat)).toEqual([64, 128, 192, 198]);
    expect(analysed?.anchors[0]?.time).toBe(beats[65]);
  });
});

describe("editing", () => {
  test("nudging moves the whole grid, anchors included", () => {
    const g = { ...constant, anchors: [{ beat: 8, time: 4.25 }] };
    const moved = shiftGrid(g, 0.01);
    expect(moved.firstDownbeat).toBeCloseTo(0.26);
    expect(moved.anchors[0]?.time).toBeCloseTo(4.26);
  });

  test("first downbeat here: the beat under the playhead starts a bar", () => {
    expect(setDownbeatAt(constant, 30.5).firstDownbeat).toBe(30.5);
    // With anchors, the nearest beat moves there and the beats are numbered from it.
    const g = { bpm: 120, firstDownbeat: 0, anchors: [{ beat: 16, time: 8 }] };
    const out = setDownbeatAt(g, 1.02); // beat 2 (1.0 s) becomes a downbeat at 1.02
    expect(out.firstDownbeat).toBeCloseTo(1.02);
    expect(out.anchors).toEqual([{ beat: 14, time: 8.02 }]);
    expect(downbeatTimes(toBeatGrid(out, 10), 10)).toContain(1.02);
  });

  test("×2 and ÷2 change the tempo; with anchors, the beat numbers", () => {
    expect(doubleTempo(constant).bpm).toBe(240);
    expect(halveTempo(constant).bpm).toBe(60);
    const g = { bpm: 120, firstDownbeat: 0, anchors: [{ beat: 8, time: 4 }] };
    expect(doubleTempo(g).anchors).toEqual([{ beat: 16, time: 4 }]);
    expect(halveTempo(g).anchors).toEqual([{ beat: 4, time: 4 }]);
  });

  test("anchors are added on the nearest beat, moved between neighbours and removed", () => {
    const one = addAnchor(constant, 10.1);
    expect(one.anchors).toEqual([{ beat: 20, time: 10.25 }]);
    // Adding where the grid already has an anchor keeps one.
    expect(addAnchor(one, 10.2).anchors).toHaveLength(1);
    const two = addAnchor(one, 20.3);
    expect(two.anchors.map((a) => a.beat)).toEqual([20, 40]);
    expect(moveAnchor(two, 20, 10.4).anchors[0]?.time).toBe(10.4);
    // It cannot pass its neighbours.
    expect(moveAnchor(two, 20, 21).anchors[0]?.time).toBe(10.25);
    expect(moveAnchor(two, 20, 0.1).anchors[0]?.time).toBe(10.25);
    expect(removeAnchor(two, 20).anchors).toEqual([{ beat: 40, time: 20.25 }]);
    // Beat 0 (before the first downbeat) is not an anchor.
    expect(addAnchor(constant, 0.3).anchors).toEqual([]);
  });

  test("tap tempo proposes the tempo and lines the beats up with the taps", () => {
    const taps = [10.02, 10.52, 11.01, 11.52, 12.02];
    const out = tapGrid(constant, taps);
    expect(out?.bpm).toBeCloseTo(120, 0);
    // The beats fall on the taps; the bar count stays near the old downbeat.
    if (!out) throw new Error("no grid");
    const beats = beatTimes(toBeatGrid(out, 20), 20);
    const nearest = (t: number) => Math.min(...beats.map((b) => Math.abs(b - t)));
    taps.forEach((t) => expect(nearest(t)).toBeLessThan(0.02));
    expect(Math.abs(out.firstDownbeat - 0.25)).toBeLessThan(0.3);
    expect(tapGrid(constant, [1, 1.5])).toBeNull();
    expect(tapGrid(constant, [1, 1.01, 1.02, 1.03])).toBeNull(); // 6000 BPM
  });
});
