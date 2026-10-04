import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { QuantityStepper } from "./QuantityStepper.tsx";

function Controlled({ onStep = () => {} }: { onStep?: (direction: 1 | -1) => void }) {
  const [value, setValue] = useState("20");
  return (
    <QuantityStepper
      value={value}
      unit="min"
      presets={["10", "20", "30"]}
      onChange={setValue}
      onStep={(direction) => {
        onStep(direction);
        setValue((current) => String(Number(current) + direction * 5));
      }}
    />
  );
}

describe("QuantityStepper", () => {
  it("shows the number and its unit, and the number is editable", async () => {
    render(<Controlled />);
    const input = screen.getByRole("textbox", { name: "Cantidad" });
    expect(input).toHaveValue("20");
    expect(input).toHaveAttribute("inputmode", "decimal");
    expect(screen.getByText("min")).toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, "35");
    expect(input).toHaveValue("35");
  });

  it("asks to step down and up", async () => {
    const onStep = vi.fn();
    render(<Controlled onStep={onStep} />);
    await userEvent.click(screen.getByRole("button", { name: "Menos" }));
    await userEvent.click(screen.getByRole("button", { name: "Más" }));
    await userEvent.click(screen.getByRole("button", { name: "Más" }));
    expect(onStep.mock.calls.map(([direction]) => direction)).toEqual([-1, 1, 1]);
    expect(screen.getByRole("textbox", { name: "Cantidad" })).toHaveValue("25");
  });

  it("offers the shortcuts as toggles, marking the one that matches the value", () => {
    render(<Controlled />);
    const pressed = screen
      .getAllByRole("button", { pressed: true })
      .map((button) => button.textContent);
    expect(pressed).toEqual(["20 min"]);
    expect(screen.getAllByRole("button", { pressed: false }).map((b) => b.textContent)).toEqual([
      "10 min",
      "30 min",
    ]);
  });

  it("sets the value from a shortcut", async () => {
    render(<Controlled />);
    await userEvent.click(screen.getByRole("button", { name: "30 min" }));
    expect(screen.getByRole("textbox", { name: "Cantidad" })).toHaveValue("30");
    expect(screen.getByRole("button", { name: "30 min", pressed: true })).toBeInTheDocument();
  });

  it("shows the invalid state when told the value cannot be sent", () => {
    render(
      <QuantityStepper
        value="0"
        unit="min"
        presets={[]}
        invalid
        onChange={() => {}}
        onStep={() => {}}
      />,
    );
    expect(screen.getByRole("textbox", { name: "Cantidad" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("has no shortcut row when there are no presets", () => {
    render(
      <QuantityStepper value="1" unit="vasos" presets={[]} onChange={() => {}} onStep={() => {}} />,
    );
    expect(screen.queryAllByRole("button", { pressed: false })).toHaveLength(0);
  });
});
