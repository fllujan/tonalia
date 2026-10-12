import { fireEvent, render, screen } from "@testing-library/react";
import i18n from "../i18n";
import { EnergyRange } from "./EnergyRange";

beforeEach(async () => {
  await i18n.changeLanguage("es");
});

describe("EnergyRange", () => {
  it("is two sliders where 1 and 10 mean no bound", () => {
    const onChange = vi.fn();
    render(<EnergyRange value={{}} onChange={onChange} />);
    const min = screen.getByRole("slider", { name: "Energía mínima" });
    const max = screen.getByRole("slider", { name: "Energía máxima" });
    expect(min).toHaveValue("1");
    expect(max).toHaveValue("10");
    fireEvent.change(min, { target: { value: "6" } });
    expect(onChange).toHaveBeenLastCalledWith({ energyMin: 6 });
    fireEvent.change(max, { target: { value: "8" } });
    expect(onChange).toHaveBeenLastCalledWith({ energyMax: 8 });
  });

  it("clears a bound moved back to its end", () => {
    const onChange = vi.fn();
    render(<EnergyRange value={{ energyMin: 6 }} onChange={onChange} />);
    fireEvent.change(screen.getByRole("slider", { name: "Energía mínima" }), {
      target: { value: "1" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ energyMin: null });
  });

  it("never lets the handles cross", () => {
    const onChange = vi.fn();
    render(<EnergyRange value={{ energyMin: 4, energyMax: 7 }} onChange={onChange} />);
    expect(screen.getByText("4–7")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("slider", { name: "Energía mínima" }), {
      target: { value: "9" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ energyMin: 7 });
    fireEvent.change(screen.getByRole("slider", { name: "Energía máxima" }), {
      target: { value: "2" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ energyMax: 4 });
  });
});
