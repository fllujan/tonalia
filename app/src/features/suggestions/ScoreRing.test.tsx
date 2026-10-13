// The score ring: the number always shown and, after B's manual key change, the idea's own
// score struck through before it.
import { render, screen } from "@testing-library/react";
import { ScoreRing } from "./ScoreRing";

describe("ScoreRing", () => {
  it("shows only the score while it is the idea's own", () => {
    const { container } = render(<ScoreRing score={92} from={92} label="Score 92" />);
    expect(screen.getByRole("img", { name: "Score 92" })).toHaveTextContent("92");
    expect(container.querySelector("s")).toBeNull();
  });

  it("strikes the idea's score through after a manual change", () => {
    const { container } = render(<ScoreRing score={62} from={100} label="Score 62" />);
    expect(container.querySelector("s")).toHaveTextContent("100");
    expect(screen.getByRole("img", { name: "Score 62" })).toHaveTextContent("100→62");
  });
});
