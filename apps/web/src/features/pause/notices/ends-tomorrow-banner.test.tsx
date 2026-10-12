import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  activeTodayFixture,
  dayRowFixture,
  todayPauseFixture,
  weekRowFixture,
} from "../../../testing/fixtures/today.ts";
import { renderInProviders } from "../../../testing/render.tsx";
import { EndsTomorrowBanner } from "./EndsTomorrowBanner.tsx";

type Row = ReturnType<typeof dayRowFixture>;
type PauseOverrides = Parameters<typeof todayPauseFixture>[0];

const pause = (overrides: PauseOverrides = {}) =>
  todayPauseFixture({ reason: "work", endDate: "2026-10-03", endsTomorrow: true, ...overrides });

const gym = (overrides: PauseOverrides = {}) =>
  dayRowFixture({
    commitmentId: "commitment-1" as Row["commitmentId"],
    habitName: "Gym",
    opportunity: { state: "paused", graceUntil: null },
    pause: pause(overrides),
  });

const renderBanner = (rows: Parameters<typeof EndsTomorrowBanner>[0]["rows"]) =>
  renderInProviders(<EndsTomorrowBanner rows={rows} />);

describe("the 'ends tomorrow' banner (screen 30a, PS-13)", () => {
  it("says the pause ends tomorrow and offers Reanudar and Pedir más días", async () => {
    renderBanner([gym()]);
    expect(await screen.findByText("Tu pausa de Gym termina mañana")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reanudar" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Pedir más días" })).toBeInTheDocument(),
    );
  });

  it("resumes from the banner", async () => {
    const { deps } = renderBanner([gym()]);
    await userEvent.click(await screen.findByRole("button", { name: "Reanudar" }));
    expect(screen.getByRole("dialog", { name: "¿Reanudar Gym?" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reanudar hoy" }));
    await waitFor(() => expect(deps.api.calls.resumePause).toBe(1));
    expect(deps.api.pauseCommands[0]?.args).toEqual(["pause-1", "commitment-1"]);
  });

  it("opens the request sheet from the day after the end, for that Commitment", async () => {
    renderInProviders(<EndsTomorrowBanner rows={[gym({ endDate: "2026-10-03" })]} />, {
      today: activeTodayFixture({ rows: [gym()] }),
    });
    await userEvent.click(await screen.findByRole("button", { name: "Pedir más días" }));
    expect(await screen.findByRole("dialog", { name: "Pausar un compromiso" })).toBeInTheDocument();
    expect(await screen.findByLabelText("Primer día")).toHaveValue("2026-10-04");
    expect(screen.getByRole("button", { name: "Gym" })).toHaveAttribute("aria-pressed", "true");
  });

  it("is one banner for a Todos request, resuming every Commitment of it", async () => {
    const { deps } = renderBanner([
      gym(),
      weekRowFixture({
        commitmentId: "commitment-2" as Row["commitmentId"],
        habitName: "Leer",
        opportunity: { state: "paused", graceUntil: null },
        progress: null,
        pause: pause(),
      }),
    ]);
    expect(await screen.findByText("Tu pausa de Gym y Leer termina mañana")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Reanudar" })).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Reanudar" }));
    await userEvent.click(screen.getByRole("button", { name: "Reanudar hoy" }));
    await waitFor(() => expect(deps.api.calls.resumePause).toBe(1));
    expect(deps.api.pauseCommands[0]?.args).toEqual(["pause-1"]);
  });

  it("is one banner per request when two requests end tomorrow", async () => {
    renderBanner([
      gym(),
      dayRowFixture({
        commitmentId: "commitment-5" as Row["commitmentId"],
        habitName: "Correr",
        opportunity: { state: "paused", graceUntil: null },
        pause: pause({ pauseRequestId: "pause-2" }),
      }),
    ]);
    expect(await screen.findByText("Tu pausa de Gym termina mañana")).toBeInTheDocument();
    expect(screen.getByText("Tu pausa de Correr termina mañana")).toBeInTheDocument();
  });

  it("reuses the banner for an open pause that hits its limit tomorrow (Q12), without asking for more days", async () => {
    renderBanner([gym({ endDate: null })]);
    expect(
      await screen.findByText("Tu pausa de Gym llega mañana al máximo de días"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reanudar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pedir más días" })).not.toBeInTheDocument();
  });

  it("does not offer more days when the season ends first", async () => {
    // The season ends 2026-10-25.
    renderBanner([gym({ endDate: "2026-10-25" })]);
    expect(await screen.findByText("Tu pausa de Gym termina mañana")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Reanudar" })).toBeEnabled());
    expect(screen.queryByRole("button", { name: "Pedir más días" })).not.toBeInTheDocument();
  });

  it.each([
    ["not the day before", { endsTomorrow: false }],
    ["a pending request", { status: "pending", canResume: false, canCancel: true }],
  ] as const)("shows nothing for %s", (_label, overrides) => {
    renderBanner([gym(overrides)]);
    expect(screen.queryByText(/termina mañana|máximo de días/)).not.toBeInTheDocument();
  });

  it("shows nothing for a row without a pause", () => {
    renderBanner([dayRowFixture()]);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("cannot resume or ask without a connection", async () => {
    renderInProviders(<EndsTomorrowBanner rows={[gym()]} />, { online: false });
    expect(await screen.findByRole("button", { name: "Reanudar" })).toBeDisabled();
  });
});
