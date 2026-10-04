import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeTodayFixture, pendingItemFixture } from "../../../testing/fixtures/today.ts";
import { renderApp } from "../../../testing/render.tsx";

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

const circle = (name: string) => screen.findByRole("button", { name: `Registrar ${name}` });

describe("De ayer: no second registration after the first (WB-3)", () => {
  it("disables both controls once the entry is recorded, and the check does not unfill while the item is listed", async () => {
    const { deps } = renderApp({
      today: activeTodayFixture({ pendingYesterday: [pendingItemFixture()] }),
    });
    const done = await circle("Dibujar de ayer");
    await userEvent.click(done);
    await waitFor(() => expect(deps.api.recorded).toHaveLength(1));
    const miss = screen.getByRole("button", { name: "Ayer no salió: Dibujar" });
    await waitFor(() => expect(miss).toBeDisabled());
    expect(done).toBeDisabled();
    // Past the settle time the check is still filled: the item is still on the list.
    act(() => vi.advanceTimersByTime(5000));
    expect(done).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(miss);
    expect(deps.api.recorded).toHaveLength(1);
  });
});

describe("De ayer: copy of yesterday (WB-6)", () => {
  it("the cross says it was yesterday's that did not go out", async () => {
    renderApp({ today: activeTodayFixture({ pendingYesterday: [pendingItemFixture()] }) });
    await userEvent.click(await screen.findByRole("button", { name: "Ayer no salió: Dibujar" }));
    expect(await screen.findByText("Anotado: ayer no salió.")).toBeInTheDocument();
  });
});
