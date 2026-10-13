import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InlineMessage } from "./InlineMessage.tsx";

describe("InlineMessage", () => {
  it("announces an error assertively as an alert", () => {
    render(<InlineMessage tone="error" title="No se pudo registrar" />);
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo registrar");
  });

  it.each(["info", "success", "pending"] as const)("announces %s politely as a status", (tone) => {
    render(<InlineMessage tone={tone} title="Aviso" />);
    expect(screen.getByRole("status")).toHaveTextContent("Aviso");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the body text under the title", () => {
    render(
      <InlineMessage tone="error" title="Sin conexión">
        Revisa tu red e inténtalo de nuevo.
      </InlineMessage>,
    );
    expect(screen.getByText("Sin conexión")).toBeInTheDocument();
    expect(screen.getByText("Revisa tu red e inténtalo de nuevo.")).toBeInTheDocument();
  });

  it("renders the action inside the body column, after the text", () => {
    render(
      <InlineMessage
        tone="error"
        title="Falló"
        action={<button type="button">Reintentar</button>}
      />,
    );
    const button = screen.getByRole("button", { name: "Reintentar" });
    const body = screen.getByText("Falló").parentElement;
    expect(body).toContainElement(button);
    expect(body?.lastElementChild).toContainElement(button);
  });

  it("draws a decorative icon for the tone", () => {
    const { container } = render(<InlineMessage tone="success" title="Hecho" />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
