import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeTodayFixture, weekRowFixture } from "../../../testing/fixtures/today.ts";
import { renderInProviders } from "../../../testing/render.tsx";
import { EntrySheet } from "./EntrySheet.tsx";

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

describe("closing is idempotent (WA-S4)", () => {
  it("Escape and the button in the same tick call onClose once, and toast once", async () => {
    // The sheet is rendered on its own with a close that does NOT unmount it, so nothing but the
    // guard stops the second call (a router's synchronous navigate would hide its absence).
    const onClose = vi.fn();
    const { deps } = renderInProviders(
      <EntrySheet row={weekRowFixture()} seasonId="season-1" onClose={onClose} />,
      { today: activeTodayFixture({ rows: [weekRowFixture()] }) },
    );
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Registrar 20 min" }));
    const cta = await screen.findByRole("button", { name: "Seguir con mi día" });
    act(() => {
      fireEvent.click(cta);
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(
      screen.getAllByRole("status").filter((el) => el.textContent?.includes("Leer · +")),
    ).toHaveLength(0);
    expect(deps.api.recorded).toHaveLength(1);
  });
});
