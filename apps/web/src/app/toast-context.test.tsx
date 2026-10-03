import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, useToasts } from "./toast-context.tsx";

function Trigger({ toast }: { toast: Parameters<ReturnType<typeof useToasts>["show"]>[0] }) {
  const { show, dismiss } = useToasts();
  return (
    <>
      <button type="button" onClick={() => show(toast)}>
        mostrar
      </button>
      <button type="button" onClick={dismiss}>
        quitar
      </button>
    </>
  );
}

const setup = (toast: Parameters<typeof Trigger>[0]["toast"]) =>
  render(
    <ToastProvider>
      <Trigger toast={toast} />
    </ToastProvider>,
  );

describe("ToastProvider", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("keeps a live region mounted before any toast, so the first one is announced", async () => {
    setup({ message: "Registro guardado." });
    const region = document.querySelector("[aria-live]");
    expect(region).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "mostrar" }));
    expect(document.querySelector("[aria-live]")).toBe(region);
    expect(region).toContainElement(screen.getByRole("status"));
  });

  it("shows a toast with its message when asked", async () => {
    setup({ message: "Registro guardado." });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "mostrar" }));
    expect(screen.getByRole("status")).toHaveTextContent("Registro guardado.");
  });

  it("runs the action and removes the toast", async () => {
    const onAction = vi.fn();
    setup({ message: "Guardado", actionLabel: "Deshacer", onAction });
    await userEvent.click(screen.getByRole("button", { name: "mostrar" }));
    await userEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("removes itself after the default time", async () => {
    setup({ message: "Guardado" });
    await userEvent.click(screen.getByRole("button", { name: "mostrar" }));
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps a persistent error toast until it is acted on or dismissed", async () => {
    setup({
      message: "Falló",
      tone: "error",
      durationMs: null,
      actionLabel: "Reintentar",
      onAction: () => {},
    });
    await userEvent.click(screen.getByRole("button", { name: "mostrar" }));
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByRole("alert")).toHaveTextContent("Falló");
    await userEvent.click(screen.getByRole("button", { name: "quitar" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("replaces the current toast with the next one", async () => {
    function Two() {
      const { show } = useToasts();
      return (
        <>
          <button type="button" onClick={() => show({ message: "Uno" })}>
            uno
          </button>
          <button type="button" onClick={() => show({ message: "Dos" })}>
            dos
          </button>
        </>
      );
    }
    render(
      <ToastProvider>
        <Two />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "uno" }));
    await userEvent.click(screen.getByRole("button", { name: "dos" }));
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("Dos");
  });

  it("restarts the countdown when a new toast replaces the old one", async () => {
    function Two() {
      const { show } = useToasts();
      return (
        <button type="button" onClick={() => show({ message: `Toast ${Date.now()}` })}>
          nuevo
        </button>
      );
    }
    render(
      <ToastProvider>
        <Two />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "nuevo" }));
    act(() => vi.advanceTimersByTime(3000));
    await userEvent.click(screen.getByRole("button", { name: "nuevo" }));
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByRole("status")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("useToasts", () => {
  it("fails loudly outside a provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Trigger toast={{ message: "x" }} />)).toThrow(/ToastProvider/);
    spy.mockRestore();
  });
});
