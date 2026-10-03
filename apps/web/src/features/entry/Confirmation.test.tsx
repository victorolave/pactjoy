import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Confirmation } from "./Confirmation.tsx";

describe("Confirmation", () => {
  it("says the registro was saved, what it was, and closes from its button", async () => {
    const onClose = vi.fn();
    render(<Confirmation detail="Leer · 20 min" onClose={onClose} />);
    expect(screen.getByText("Registro guardado.")).toBeInTheDocument();
    expect(screen.getByText("Leer · 20 min")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Registro guardado" })).toHaveAttribute(
      "src",
      expect.stringContaining("registro-guardado"),
    );
    await userEvent.click(screen.getByRole("button", { name: "Seguir con mi día" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("draws the illustration in its own 200 box, not at the sheet's full width (design 20)", () => {
    render(<Confirmation detail="Leer" onClose={() => {}} />);
    expect(screen.getByRole("img", { name: "Registro guardado" })).toHaveAttribute(
      "data-size",
      "lg",
    );
  });

  it("shows the points the server gave, and the closing line", () => {
    render(
      <Confirmation
        detail="Leer · 20 min"
        points={4}
        message="Mínimo cumplido. Un paso más en tu meta."
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("+4 pts")).toBeInTheDocument();
    expect(screen.getByText("Mínimo cumplido. Un paso más en tu meta.")).toBeInTheDocument();
  });

  it("shows no points when there are none to show, or zero", () => {
    const { rerender } = render(<Confirmation detail="Leer" onClose={() => {}} />);
    expect(screen.queryByText(/pts/)).not.toBeInTheDocument();
    rerender(<Confirmation detail="Leer" points={0} onClose={() => {}} />);
    expect(screen.queryByText(/pts/)).not.toBeInTheDocument();
  });
});

describe("Confirmation stays until the user leaves", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does not close on its own, however long it stays", () => {
    const onClose = vi.fn();
    render(<Confirmation detail="Leer · 20 min" onClose={onClose} />);
    act(() => vi.advanceTimersByTime(60_000));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Registro guardado.")).toBeInTheDocument();
  });
});
