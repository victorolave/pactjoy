import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeTodayFixture, weekRowFixture } from "../../../testing/fixtures/today.ts";
import { renderApp } from "../../../testing/render.tsx";

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

describe("after a save, the confirmation is announced and focused (WA-W5)", () => {
  it("moves focus into the confirmation, announces it, and hides the duplicate illustration", async () => {
    const row = weekRowFixture();
    renderApp({ path: "/?entry=commitment-2", today: activeTodayFixture({ rows: [row] }) });
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Registrar 20 min" }));
    const title = await screen.findByText("Registro guardado.");
    const confirmation = title.closest("[role='status']") as HTMLElement;
    expect(confirmation).not.toBeNull();
    expect(confirmation.contains(document.activeElement)).toBe(true);
    expect(confirmation.querySelector("img")).toHaveAttribute("alt", "");
  });
});
