import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TextField } from "./TextField.tsx";

describe("TextField", () => {
  it("labels the input so it can be found by its label", () => {
    render(<TextField label="Correo" />);
    expect(screen.getByLabelText("Correo")).toBeInTheDocument();
  });

  it("passes input attributes through and reports typing", async () => {
    const onChange = vi.fn();
    render(<TextField label="Correo" type="email" inputMode="email" onChange={onChange} />);
    const input = screen.getByLabelText("Correo");
    expect(input).toHaveAttribute("type", "email");
    expect(input).toHaveAttribute("inputmode", "email");
    await userEvent.type(input, "a");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("shows a hint and ties it to the input", () => {
    render(<TextField label="Código" hint="Seis dígitos" />);
    const input = screen.getByLabelText("Código");
    expect(screen.getByText("Seis dígitos")).toBeInTheDocument();
    expect(input).toHaveAccessibleDescription("Seis dígitos");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("shows an error instead of the hint, marks the input invalid and ties the error to it", () => {
    render(<TextField label="Código" hint="Seis dígitos" error="El código no es válido" />);
    const input = screen.getByLabelText("Código");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("El código no es válido");
    expect(screen.queryByText("Seis dígitos")).not.toBeInTheDocument();
  });

  it("gives two fields different ids so labels never cross", () => {
    render(
      <>
        <TextField label="Uno" />
        <TextField label="Dos" />
      </>,
    );
    expect(screen.getByLabelText("Uno").id).not.toBe(screen.getByLabelText("Dos").id);
  });
});
