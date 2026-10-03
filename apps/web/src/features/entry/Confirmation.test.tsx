import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Confirmation, useAutoClose } from "./Confirmation.tsx";

describe("Confirmation", () => {
  it("says the registro was saved, what it was, and closes from its button", async () => {
    const onClose = vi.fn();
    render(<Confirmation detail="Leer · 20 min" onClose={onClose} />);
    expect(screen.getByText("Registro guardado.")).toBeInTheDocument();
    expect(screen.getByText("Leer · 20 min")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Registro guardado" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Seguir con mi día" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("takes another title, for a deletion", () => {
    render(<Confirmation title="Registro borrado." detail="Leer" onClose={() => {}} />);
    expect(screen.getByText("Registro borrado.")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Registro borrado" })).toBeInTheDocument();
  });
});

describe("useAutoClose", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function Probe({ saved, onClose }: { saved: string | null; onClose: () => void }) {
    useAutoClose(saved, onClose);
    return null;
  }

  it("does nothing until something is saved", () => {
    const onClose = vi.fn();
    render(<Probe saved={null} onClose={onClose} />);
    act(() => vi.advanceTimersByTime(10_000));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes after 1200 ms, and not a moment before", () => {
    const onClose = vi.fn();
    render(<Probe saved="ok" onClose={onClose} />);
    act(() => vi.advanceTimersByTime(1199));
    expect(onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close after it was unmounted", () => {
    const onClose = vi.fn();
    const { unmount } = render(<Probe saved="ok" onClose={onClose} />);
    unmount();
    act(() => vi.advanceTimersByTime(5000));
    expect(onClose).not.toHaveBeenCalled();
  });
});
