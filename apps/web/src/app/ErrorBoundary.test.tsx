import { QueryClient } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTodayPersister, STORAGE_KEY } from "../adapters/query-persister.ts";
import { MemoryStorage } from "../testing/memory-storage.ts";
import { ErrorBoundary } from "./ErrorBoundary.tsx";

function Boom(): never {
  throw new TypeError("Cannot read properties of undefined (reading 'earned')");
}

beforeEach(() => {
  // React logs the error it hands to the boundary; the test does not need the noise.
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("ErrorBoundary", () => {
  it("renders its children when nothing fails", () => {
    render(
      <ErrorBoundary persister={createTodayPersister(null)} queryClient={new QueryClient()}>
        <p>Hoy</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("Hoy")).toBeInTheDocument();
  });

  it("shows a recoverable error screen instead of a blank page", () => {
    render(
      <ErrorBoundary persister={createTodayPersister(null)} queryClient={new QueryClient()}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Algo salió mal");
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it("clears the saved Today and the query cache, then goes back to the start, on Reintentar", async () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, "{}");
    const queryClient = new QueryClient();
    queryClient.setQueryData(["today"], { state: "noCircle" });
    const restart = vi.fn();
    render(
      <ErrorBoundary
        persister={createTodayPersister(storage, { throttleMs: 0 })}
        queryClient={queryClient}
        restart={restart}
      >
        <Boom />
      </ErrorBoundary>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(restart).toHaveBeenCalledTimes(1));
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
    expect(queryClient.getQueryData(["today"])).toBeUndefined();
  });

  it("still goes back to the start when the saved copy cannot be removed", async () => {
    const persister = createTodayPersister(null);
    persister.removeClient = async () => {
      throw new Error("blocked");
    };
    const restart = vi.fn();
    render(
      <ErrorBoundary persister={persister} queryClient={new QueryClient()} restart={restart}>
        <Boom />
      </ErrorBoundary>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(restart).toHaveBeenCalledTimes(1));
  });
});
