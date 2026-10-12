import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { myPauseRequestsFixture, pauseRequestFixture } from "../../../testing/fixtures/pause.ts";
import { todayPauseFixture } from "../../../testing/fixtures/today.ts";
import { type RenderAppOptions, renderInProviders } from "../../../testing/render.tsx";
import { RowPauseActions, type RowPauseActionsProps } from "./RowPauseActions.tsx";

type Pause = RowPauseActionsProps["pause"];

const approved = (overrides: Parameters<typeof todayPauseFixture>[0] = {}): Pause =>
  todayPauseFixture({ reason: "health", ...overrides });

const pending = (overrides: Parameters<typeof todayPauseFixture>[0] = {}): Pause =>
  approved({ status: "pending", canResume: false, canCancel: true, ...overrides });

async function renderActions(
  pause: Pause,
  requests = myPauseRequestsFixture({ mine: [pauseRequestFixture({ startDate: "2026-10-01" })] }),
  options: RenderAppOptions = {},
) {
  const view = renderInProviders(
    <RowPauseActions pause={pause} commitmentId="commitment-1" habitName="Meditar" />,
    options,
  );
  view.deps.api.setMyPauseRequests(requests);
  await view.deps.queryClient.refetchQueries({ queryKey: ["pauseRequests"] });
  return view;
}

describe("pause actions on a Today row (screen 29, PS-11, PS-12)", () => {
  it("offers Reanudar on an approved pause, and resumes only that Commitment", async () => {
    const { deps } = await renderActions(approved());
    await userEvent.click(screen.getByRole("button", { name: "Reanudar" }));
    expect(screen.getByRole("dialog", { name: "¿Reanudar Meditar?" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reanudar hoy" }));
    await waitFor(() =>
      expect(deps.api.pauseCommands).toEqual([
        { method: "resumePause", args: ["pause-1", "commitment-1"] },
      ]),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("labels an approved pause that has not started as the cancel it is", async () => {
    // The request starts tomorrow (Today is 2026-10-02).
    await renderActions(
      approved(),
      myPauseRequestsFixture({
        mine: [pauseRequestFixture({ status: "approved", startDate: "2026-10-03" })],
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Cancelar pausa" })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "Reanudar" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancelar pausa" }));
    expect(
      screen.getByRole("dialog", { name: "¿Cancelar la pausa de Meditar?" }),
    ).toBeInTheDocument();
  });

  it("offers 'Ver solicitud' and 'Cancelar solicitud' on a pending one (PS-11)", async () => {
    const { deps } = await renderActions(pending());
    await userEvent.click(screen.getByRole("button", { name: "Cancelar solicitud" }));
    expect(screen.getByRole("dialog", { name: "¿Cancelar la solicitud?" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sí, cancelar" }));
    await waitFor(() =>
      expect(deps.api.pauseCommands).toEqual([{ method: "cancelPauseRequest", args: ["pause-1"] }]),
    );
  });

  it("opens the request itself from 'Ver solicitud' (screen 27)", async () => {
    await renderActions(pending());
    await userEvent.click(await screen.findByRole("button", { name: "Ver solicitud" }));
    const dialog = await screen.findByRole("dialog", { name: "Tu solicitud de pausa" });
    expect(within(dialog).getByRole("heading", { name: "Pausa en espera" })).toBeInTheDocument();
    expect(within(dialog).getByText(/Se aprobará automáticamente el/)).toBeInTheDocument();
  });

  it("offers nothing for a pause that can neither be resumed nor cancelled", async () => {
    await renderActions(approved({ canResume: false }));
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("is off without a connection", async () => {
    await renderActions(approved(), undefined, { online: false });
    expect(screen.getByRole("button", { name: "Reanudar" })).toBeDisabled();
  });
});
