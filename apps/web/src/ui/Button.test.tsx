import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button.tsx";

describe("Button", () => {
  it("is a button that does not submit forms unless asked", () => {
    render(<Button>Guardar</Button>);
    expect(screen.getByRole("button", { name: "Guardar" })).toHaveAttribute("type", "button");
  });

  it("can be a submit button", () => {
    render(<Button type="submit">Enviar</Button>);
    expect(screen.getByRole("button", { name: "Enviar" })).toHaveAttribute("type", "submit");
  });

  it("calls onClick when pressed", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Registrar</Button>);
    await userEvent.click(screen.getByRole("button", { name: "Registrar" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not call onClick when disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Registrar
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Registrar" });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders a decorative leading icon next to the label", () => {
    const { container } = render(<Button leadingIcon="circle-check">Hecho</Button>);
    expect(screen.getByRole("button", { name: "Hecho" })).toBeInTheDocument();
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("renders without an icon by default", () => {
    const { container } = render(<Button variant="secondary">Cancelar</Button>);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders a decorative trailing icon next to the label", () => {
    const { container } = render(<Button trailingIcon="chevron-right">Continuar</Button>);
    expect(screen.getByRole("button", { name: "Continuar" })).toBeInTheDocument();
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("svg")).toHaveClass("lucide-chevron-right");
  });

  it("uses size 18 icons for small buttons", () => {
    const { container } = render(
      <Button size="sm" leadingIcon="circle-check">
        Listo
      </Button>,
    );
    expect(container.querySelector("svg")).toHaveStyle({ width: "var(--icon-18)" });
  });
});
