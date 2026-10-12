import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../../ports/api-error.ts";
import { myPauseRequestsFixture } from "../../../testing/fixtures/pause.ts";
import { renderInProviders } from "../../../testing/render.tsx";
import { ResumeSheet, type ResumeSheetProps } from "./ResumeSheet.tsx";

const render = (props: Partial<ResumeSheetProps> = {}, options = {}) => {
  let closed = 0;
  const view = renderInProviders(
    <ResumeSheet
      open
      pauseRequestId="pause-1"
      commitmentId="c-1"
      subject="Gym"
      onClose={() => closed++}
      {...props}
    />,
    options,
  );
  return { ...view, closed: () => closed };
};

describe("resuming a pause (screen 29, PS-11, PS-12)", () => {
  it("asks '¿Reanudar Gym?' and says it counts again from today with no approval", () => {
    render();
    expect(screen.getByRole("dialog", { name: "¿Reanudar Gym?" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Vuelve a contar desde hoy y esta semana se prorratea por los días que estuvo activo. No necesitas aprobación.",
      ),
    ).toBeInTheDocument();
  });

  describe("the week's opportunities after resuming (W3)", () => {
    const COUNT_TEXT = (n: string) =>
      `Vuelve a contar desde hoy. Esta semana tendrás ${n}. La semana se prorratea por los días que estuvo activo.`;
    const withPreview = async (
      weekOpportunities: number | null,
      props: Partial<ResumeSheetProps> = {},
    ) => {
      const view = render(props);
      view.deps.api.setMyPauseRequests(
        myPauseRequestsFixture({
          resumePreviews: [
            { pauseRequestId: "pause-1", commitmentId: "c-1", weekOpportunities },
            { pauseRequestId: "pause-2", commitmentId: "c-1", weekOpportunities: 9 },
          ],
        }),
      );
      await view.deps.queryClient.refetchQueries({ queryKey: ["pauseRequests"] });
      return view;
    };

    it("says how many opportunities the week holds, in the plural", async () => {
      await withPreview(3);
      expect(await screen.findByText(COUNT_TEXT("3 oportunidades"))).toBeInTheDocument();
    });

    it("uses the singular for one", async () => {
      await withPreview(1);
      expect(await screen.findByText(COUNT_TEXT("1 oportunidad"))).toBeInTheDocument();
    });

    it("shows no count for Todos, even when a preview exists", async () => {
      await withPreview(3, { commitmentId: undefined });
      await waitFor(() => expect(screen.queryByText(/oportunidad/)).not.toBeInTheDocument());
      expect(screen.getByText(/esta semana se prorratea/)).toBeInTheDocument();
    });

    it("keeps the current text for a null preview", async () => {
      await withPreview(null);
      expect(screen.getByText(/esta semana se prorratea/)).toBeInTheDocument();
      expect(screen.queryByText(/oportunidad/)).not.toBeInTheDocument();
    });

    it("keeps the cancel text and no count for a pause that has not started", async () => {
      await withPreview(3, { startsLater: true });
      expect(screen.getByText(/Todavía no empezó/)).toBeInTheDocument();
      expect(screen.queryByText(/oportunidad/)).not.toBeInTheDocument();
    });
  });

  it("'Seguir en pausa' closes without resuming", async () => {
    const { deps, closed } = render();
    await userEvent.click(screen.getByRole("button", { name: "Seguir en pausa" }));
    expect(closed()).toBe(1);
    expect(deps.api.calls.resumePause).toBe(0);
  });

  it("'Reanudar hoy' resumes that Commitment of the request and closes", async () => {
    const { deps, closed } = render();
    await userEvent.click(screen.getByRole("button", { name: "Reanudar hoy" }));
    await waitFor(() => expect(closed()).toBe(1));
    expect(deps.api.pauseCommands).toEqual([{ method: "resumePause", args: ["pause-1", "c-1"] }]);
  });

  it("resumes every Commitment still running when none is named (Todos, PL-33)", async () => {
    const { deps } = render({ commitmentId: undefined, subject: "tus compromisos" });
    expect(screen.getByRole("dialog", { name: "¿Reanudar tus compromisos?" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reanudar hoy" }));
    await waitFor(() => expect(deps.api.calls.resumePause).toBe(1));
    expect(deps.api.pauseCommands[0]?.args).toEqual(["pause-1"]);
  });

  it("labels a pause that has not started as a cancel (PS-12, Q6)", async () => {
    const { deps, closed } = render({ startsLater: true });
    expect(screen.getByRole("dialog", { name: "¿Cancelar la pausa de Gym?" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Todavía no empezó: se cancela y recuperas esos días de pausa. No necesitas aprobación.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reanudar hoy" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancelar pausa" }));
    await waitFor(() => expect(closed()).toBe(1));
    expect(deps.api.calls.resumePause).toBe(1);
  });

  it("keeps the sheet open and says why when the pause is no longer running", async () => {
    const { deps, closed } = render();
    deps.api.failNext("resumePause", new ApiError("PauseNotActive", 409, null));
    await userEvent.click(screen.getByRole("button", { name: "Reanudar hoy" }));
    expect(await screen.findByText("Esta pausa ya no está en curso.")).toBeInTheDocument();
    expect(closed()).toBe(0);
  });

  it("is off without a connection, and cannot be dismissed mid-request", async () => {
    render({}, { online: false });
    expect(screen.getByRole("button", { name: "Reanudar hoy" })).toBeDisabled();
  });

  it("cannot be sent twice while in flight", async () => {
    const { deps } = render();
    const release = deps.api.hold("resumePause");
    await userEvent.click(screen.getByRole("button", { name: "Reanudar hoy" }));
    expect(screen.getByRole("button", { name: "Reanudar hoy" })).toBeDisabled();
    release();
    await waitFor(() => expect(deps.api.calls.resumePause).toBe(1));
  });
});
