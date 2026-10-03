import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Sheet } from "./Sheet.tsx";

function Harness({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Abrir
      </button>
      <Sheet
        open={open}
        title="Leer"
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        actions={<button type="button">Registrar</button>}
      >
        <input aria-label="Minutos" />
      </Sheet>
    </>
  );
}

describe("Sheet", () => {
  it("renders nothing while closed", () => {
    render(<Sheet open={false} title="Leer" onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("is a modal dialog named by its title, with children and actions", () => {
    render(
      <Sheet
        open
        title="Leer"
        onClose={() => {}}
        actions={<button type="button">Registrar</button>}
      >
        <p>Hoy · mínimo 10 min</p>
      </Sheet>,
    );
    const dialog = screen.getByRole("dialog", { name: "Leer" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Hoy · mínimo 10 min")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar" })).toBeInTheDocument();
  });

  it("can drop its header: only the grabber, still named for assistive tech, still closable by Escape", async () => {
    const onClose = vi.fn();
    render(
      <Sheet open headless title="Leer" onClose={onClose}>
        <button type="button">Seguir con mi día</button>
      </Sheet>,
    );
    expect(screen.getByRole("dialog", { name: "Leer" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Leer" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cerrar" })).not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("moves focus inside when it opens", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Abrir" }));
    expect(screen.getByRole("dialog")).toContainElement(document.activeElement as HTMLElement);
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Abrir" }));
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes from the Cerrar button", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Abrir" }));
    await userEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when the scrim is pressed, but not when the sheet itself is", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Abrir" }));
    await userEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    const scrim = screen.getByRole("dialog").parentElement as HTMLElement;
    await userEvent.click(scrim);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps Tab inside the dialog, wrapping at both ends", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Abrir" }));
    const close = screen.getByRole("button", { name: "Cerrar" });
    const register = screen.getByRole("button", { name: "Registrar" });
    register.focus();
    await userEvent.tab();
    expect(close).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(register).toHaveFocus();
  });

  it("still closes on Escape and traps Tab after focus fell onto non-focusable content", async () => {
    const onClose = vi.fn();
    render(
      <Sheet open title="Leer" onClose={onClose} actions={<button type="button">Registrar</button>}>
        <p>Texto sin foco</p>
      </Sheet>,
    );
    await userEvent.click(screen.getByText("Texto sin foco"));
    expect(screen.getByRole("dialog")).not.toContainElement(document.activeElement as HTMLElement);
    await userEvent.tab();
    expect(screen.getByRole("dialog")).toContainElement(document.activeElement as HTMLElement);
    await userEvent.click(screen.getByText("Texto sin foco"));
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("returns focus to the control that opened it", async () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Abrir" });
    await userEvent.click(opener);
    await userEvent.keyboard("{Escape}");
    expect(opener).toHaveFocus();
  });

  it("can be centred instead of anchored to the bottom", () => {
    render(<Sheet open title="Borrar" placement="center" onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: "Borrar" })).toBeInTheDocument();
  });
});
