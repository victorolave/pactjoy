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

  it("keeps its 1200 ms when the callback changes meanwhile (Today refetching re-renders)", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Probe saved="ok" onClose={first} />);
    act(() => vi.advanceTimersByTime(800));
    rerender(<Probe saved="ok" onClose={second} />);
    act(() => vi.advanceTimersByTime(400));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
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
