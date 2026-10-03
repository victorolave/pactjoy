import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Toast } from "./Toast.tsx";

describe("Toast", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("announces its message politely", () => {
    render(<Toast message="Registro guardado." />);
    expect(screen.getByRole("status")).toHaveTextContent("Registro guardado.");
  });

  it("announces an error toast as an alert", () => {
    render(<Toast tone="error" message="No pudimos guardar el registro." />);
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos guardar el registro.");
  });

  it("offers an action that calls onAction", async () => {
    const onAction = vi.fn();
    render(<Toast message="Guardado" actionLabel="Deshacer" onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("has no button without an action label", () => {
    render(<Toast message="Guardado" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("dismisses itself after 4000 ms by default, and not before", () => {
    const onDismiss = vi.fn();
    render(<Toast message="Guardado" onDismiss={onDismiss} />);
    act(() => vi.advanceTimersByTime(3999));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("honours a custom duration", () => {
    const onDismiss = vi.fn();
    render(<Toast message="Guardado" onDismiss={onDismiss} durationMs={1000} />);
    act(() => vi.advanceTimersByTime(1000));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("stays until acted on when the duration is null", () => {
    const onDismiss = vi.fn();
    render(<Toast tone="error" message="Falló" onDismiss={onDismiss} durationMs={null} />);
    act(() => vi.advanceTimersByTime(60_000));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("does not dismiss after it was removed", () => {
    const onDismiss = vi.fn();
    const { unmount } = render(<Toast message="Guardado" onDismiss={onDismiss} />);
    unmount();
    act(() => vi.advanceTimersByTime(10_000));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("keeps an action toast up for 8 s, long enough to reach Deshacer or Reintentar", () => {
    const onDismiss = vi.fn();
    render(<Toast message="Guardado" actionLabel="Deshacer" onDismiss={onDismiss} />);
    act(() => vi.advanceTimersByTime(7999));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("waits while the pointer is over it or focus is inside, then counts again", async () => {
    const onDismiss = vi.fn();
    render(<Toast message="Guardado" actionLabel="Deshacer" onDismiss={onDismiss} />);
    const toast = screen.getByRole("status");
    fireEvent.mouseEnter(toast);
    act(() => vi.advanceTimersByTime(60_000));
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.mouseLeave(toast);
    act(() => vi.advanceTimersByTime(8000));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("waits while a control inside it has focus", () => {
    const onDismiss = vi.fn();
    render(<Toast message="Guardado" actionLabel="Deshacer" onDismiss={onDismiss} />);
    act(() => screen.getByRole("button", { name: "Deshacer" }).focus());
    act(() => vi.advanceTimersByTime(60_000));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("restarts the countdown when the message changes", () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<Toast message="Uno" onDismiss={onDismiss} />);
    act(() => vi.advanceTimersByTime(3000));
    rerender(<Toast message="Dos" onDismiss={onDismiss} />);
    act(() => vi.advanceTimersByTime(3000));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1000));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("does not stack a polite live region on an alert", () => {
    render(<Toast tone="error" message="Falló" />);
    expect(screen.getByRole("alert")).not.toHaveAttribute("aria-live");
  });
});
