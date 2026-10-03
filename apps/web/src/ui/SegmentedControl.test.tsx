import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "./SegmentedControl.tsx";

const OPTIONS = [
  { value: "hoy", label: "Hoy" },
  { value: "ayer", label: "Ayer" },
  { value: "otro", label: "Otro" },
] as const;

describe("SegmentedControl", () => {
  it("is a named radio group with one checked option", () => {
    render(<SegmentedControl label="Día" options={OPTIONS} value="ayer" onChange={() => {}} />);
    expect(screen.getByRole("radiogroup", { name: "Día" })).toBeInTheDocument();
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => [r.textContent, r.getAttribute("aria-checked")])).toEqual([
      ["Hoy", "false"],
      ["Ayer", "true"],
      ["Otro", "false"],
    ]);
  });

  it("reports the pressed option value", async () => {
    const onChange = vi.fn();
    render(<SegmentedControl label="Día" options={OPTIONS} value="hoy" onChange={onChange} />);
    await userEvent.click(screen.getByRole("radio", { name: "Otro" }));
    expect(onChange).toHaveBeenCalledWith("otro");
  });

  it("only the checked option is in the tab order", () => {
    render(<SegmentedControl label="Día" options={OPTIONS} value="ayer" onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: "Ayer" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "Hoy" })).toHaveAttribute("tabindex", "-1");
  });

  it("moves the selection with the arrow keys, wrapping around", async () => {
    const seen: string[] = [];
    function Controlled() {
      const [value, setValue] = useState<"hoy" | "ayer" | "otro">("otro");
      return (
        <SegmentedControl
          label="Día"
          options={OPTIONS}
          value={value}
          onChange={(next) => {
            seen.push(next);
            setValue(next);
          }}
        />
      );
    }
    render(<Controlled />);
    screen.getByRole("radio", { name: "Otro" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Hoy" })).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("radio", { name: "Otro" })).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(seen).toEqual(["hoy", "otro", "ayer"]);
    expect(screen.getByRole("radio", { name: "Ayer" })).toHaveAttribute("aria-checked", "true");
  });
});
