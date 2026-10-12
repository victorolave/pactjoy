import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { myPauseRequestsFixture, pauseRequestFixture } from "../../../testing/fixtures/pause.ts";
import {
  dayRowFixture,
  todayPauseFixture,
  weekRowFixture,
} from "../../../testing/fixtures/today.ts";
import { renderInProviders } from "../../../testing/render.tsx";
import { PausedRow } from "./PausedRow.tsx";

describe("paused and on-hold rows (TO-R5, TO-S8)", () => {
  it.each([
    ["paused", "En pausa"],
    ["onHold", "En espera"],
  ] as const)("shows %s as a read-only row tagged %s, without controls", (state, tag) => {
    render(<PausedRow row={dayRowFixture({ opportunity: { state, graceUntil: null } })} />);
    expect(screen.getByRole("heading", { name: "Meditar" })).toBeInTheDocument();
    expect(screen.getByText(tag)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows a paused week row the same way, with no progress bar", () => {
    render(
      <PausedRow
        row={weekRowFixture({ opportunity: { state: "paused", graceUntil: null }, progress: null })}
      />,
    );
    expect(screen.getByRole("heading", { name: "Leer" })).toBeInTheDocument();
    expect(screen.getByText("En pausa")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});

describe("a row that belongs to a pause (screen 29, PS-11)", () => {
  const pause = (overrides: Parameters<typeof todayPauseFixture>[0] = {}) =>
    todayPauseFixture({ reason: "health", ...overrides });

  it("says 'En pausa' with the reason and offers Reanudar for an approved pause", async () => {
    const { deps } = renderInProviders(
      <PausedRow
        row={dayRowFixture({ opportunity: { state: "paused", graceUntil: null }, pause: pause() })}
      />,
    );
    expect(screen.getByText("En pausa · Salud o lesión")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reanudar" }));
    await userEvent.click(screen.getByRole("button", { name: "Reanudar hoy" }));
    await waitFor(() => expect(deps.api.calls.resumePause).toBe(1));
    expect(deps.api.pauseCommands[0]?.args).toEqual(["pause-1", "commitment-1"]);
  });

  it("says 'En espera' and offers to cancel a pending request", async () => {
    const { deps } = renderInProviders(
      <PausedRow
        row={dayRowFixture({
          opportunity: { state: "onHold", graceUntil: null },
          pause: pause({ status: "pending", canResume: false, canCancel: true }),
        })}
      />,
    );
    deps.api.setMyPauseRequests(myPauseRequestsFixture({ mine: [pauseRequestFixture()] }));
    expect(screen.getByText("En espera")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reanudar" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancelar solicitud" }));
    expect(screen.getByRole("dialog", { name: "¿Cancelar la solicitud?" })).toBeInTheDocument();
  });

  it.each(["health", "travel", "work", "other"] as const)(
    "names the %s reason in Spanish",
    (reason) => {
      const labels = { health: "Salud o lesión", travel: "Viaje", work: "Trabajo", other: "Otro" };
      renderInProviders(
        <PausedRow
          row={dayRowFixture({
            opportunity: { state: "paused", graceUntil: null },
            pause: pause({ reason }),
          })}
        />,
      );
      expect(screen.getByText(`En pausa · ${labels[reason]}`)).toBeInTheDocument();
    },
  );
});
