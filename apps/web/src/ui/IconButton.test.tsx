import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { IconButton } from "./IconButton.tsx";

describe("IconButton", () => {
  it("is named by its label, both for assistive tech and as a tooltip", () => {
    render(<IconButton icon="circle-check" label="Registrar Dibujar" />);
    const button = screen.getByRole("button", { name: "Registrar Dibujar" });
    expect(button).toHaveAttribute("title", "Registrar Dibujar");
    expect(button).toHaveAttribute("type", "button");
  });

  it("calls onClick, and not when disabled", async () => {
    const onClick = vi.fn();
    const { rerender } = render(<IconButton icon="circle-check" label="Hecho" onClick={onClick} />);
    await userEvent.click(screen.getByRole("button", { name: "Hecho" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(<IconButton icon="circle-check" label="Hecho" onClick={onClick} disabled />);
    await userEvent.click(screen.getByRole("button", { name: "Hecho" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("reports a toggle state through aria-pressed when given one", () => {
    const { rerender } = render(<IconButton icon="circle-check" label="Hecho" pressed={false} />);
    expect(screen.getByRole("button", { name: "Hecho" })).toHaveAttribute("aria-pressed", "false");
    rerender(<IconButton icon="circle-check" label="Hecho" pressed />);
    expect(screen.getByRole("button", { name: "Hecho" })).toHaveAttribute("aria-pressed", "true");
  });

  it("has no aria-pressed when it is not a toggle", () => {
    render(<IconButton icon="circle-check" label="Hecho" />);
    expect(screen.getByRole("button", { name: "Hecho" })).not.toHaveAttribute("aria-pressed");
  });
});
