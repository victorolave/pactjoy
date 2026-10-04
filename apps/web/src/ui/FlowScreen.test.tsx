import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button.tsx";
import { FlowScreen } from "./FlowScreen.tsx";

describe("FlowScreen", () => {
  it("shows the title as the page heading and the pinned action", () => {
    render(
      <FlowScreen title="Tu círculo" footer={<Button>Seguir</Button>}>
        <p>Contenido</p>
      </FlowScreen>,
    );
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Tu círculo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Seguir" })).toBeInTheDocument();
  });

  it("submits as a form when it has onSubmit, so Enter in a field works", async () => {
    const onSubmit = vi.fn((event: { preventDefault(): void }) => event.preventDefault());
    render(
      <FlowScreen title="Hola" onSubmit={onSubmit} footer={<Button type="submit">Seguir</Button>}>
        <input aria-label="Nombre" />
      </FlowScreen>,
    );
    await userEvent.type(screen.getByLabelText("Nombre"), "a{Enter}");
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
