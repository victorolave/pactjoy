import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { pairCircleFixture } from "../../testing/fixtures/circle.ts";
import { activeTodayFixture, dayRowFixture, weekRowFixture } from "../../testing/fixtures/today.ts";
import { renderApp } from "../../testing/render.tsx";

/**
 * The names a reminder push may show (D2 owner decision): Today leaves on the device the names of
 * the member's own VISIBLE commitments, so the worker can say "Es hora de Meditar"; a private
 * commitment's name never lands there. Signing out forgets them.
 */

const today = () =>
  activeTodayFixture({
    rows: [
      dayRowFixture({ habitName: "Meditar", privacy: "visible" }),
      weekRowFixture({ habitName: "Terapia", privacy: "private" }),
    ],
  });

describe("reminder names on the device", () => {
  it("Today leaves only its visible own habit names for the reminder copy", async () => {
    const { deps } = renderApp({ path: "/", today: today() });
    await waitFor(() =>
      expect(deps.reminderNames.current()).toEqual(new Map([["commitment-1", "Meditar"]])),
    );
    expect(JSON.stringify(deps.reminderNames.saves)).not.toContain("Terapia");
  });

  it("does not write the same names again on a refetch with nothing new", async () => {
    const { deps } = renderApp({ path: "/", today: today() });
    await waitFor(() => expect(deps.reminderNames.saves).toHaveLength(1));
    deps.api.setToday(today());
    await deps.queryClient.invalidateQueries();
    await waitFor(() => expect(deps.api.calls.getToday).toBeGreaterThan(1));
    expect(deps.reminderNames.saves).toHaveLength(1);
  });

  it("signing out forgets them", async () => {
    const { deps } = renderApp({
      path: "/profile/settings",
      today: today(),
      myCircle: pairCircleFixture(),
    });
    await userEvent.click(await screen.findByRole("button", { name: "Cerrar sesión" }));
    expect(await screen.findByRole("heading", { name: "Entrar" })).toBeInTheDocument();
    await waitFor(() => expect(deps.reminderNames.clears).toBeGreaterThan(0));
    expect(deps.reminderNames.current()).toEqual(new Map());
  });
});
