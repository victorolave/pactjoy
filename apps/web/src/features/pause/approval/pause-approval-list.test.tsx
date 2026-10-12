import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../../ports/api-error.ts";
import { myPauseRequestsFixture, pauseApprovalFixture } from "../../../testing/fixtures/pause.ts";
import { type RenderAppOptions, renderInProviders } from "../../../testing/render.tsx";
import { PauseApprovalList } from "./PauseApprovalList.tsx";

const R1 = pauseApprovalFixture({
  id: "pause-r1",
  reason: "health",
  note: "Me operan el lunes",
  startDate: "2026-10-05",
  endDate: "2026-10-09",
  autoApproveAt: "2026-10-04T14:12:00.000Z",
  requester: { memberId: "member-andrea", displayName: "Andrea" },
  commitments: [{ kind: "visible", commitmentId: "c-1", habitName: "Gym", icon: null }],
});

async function renderList(
  awaitingMe: ReturnType<typeof pauseApprovalFixture>[],
  options: RenderAppOptions = {},
) {
  const view = renderInProviders(<PauseApprovalList />, options);
  view.deps.api.setMyPauseRequests(myPauseRequestsFixture({ awaitingMe }));
  await view.deps.queryClient.refetchQueries({ queryKey: ["pauseRequests"] });
  return view;
}

describe("the approval list in the Círculo tab (screen 28, PS-8..PS-10)", () => {
  it("shows one card per request awaiting the viewer, with the note quoted", async () => {
    await renderList([R1]);
    const card = await screen.findByRole("article", { name: /Andrea pidió pausar Gym/ });
    expect(within(card).getByText("Andrea pidió pausar Gym")).toBeInTheDocument();
    expect(within(card).getByText("Salud o lesión · del 5 al 9 de octubre")).toBeInTheDocument();
    expect(within(card).getByText("“Me operan el lunes”")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Rechazar" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Aprobar" })).toBeInTheDocument();
  });

  it("says when it approves itself if the viewer does not answer", async () => {
    await renderList([R1]);
    // The test clock reads 2026-10-03T12:00Z; the request approves itself at 2026-10-04T14:12Z.
    expect(
      await screen.findByText("Se aprobará automáticamente en 26 h si no respondes."),
    ).toBeInTheDocument();
  });

  it("omits the note when there is none, and an open end reads 'hasta que la reanude'", async () => {
    await renderList([pauseApprovalFixture({ ...R1, note: null, endDate: null })]);
    const card = await screen.findByRole("article");
    expect(within(card).queryByText(/“/)).not.toBeInTheDocument();
    expect(
      within(card).getByText(/desde el 5 de octubre, hasta que la reanude/),
    ).toBeInTheDocument();
  });

  it("names a Todos request's Commitments, and a private one only as 'un objetivo privado' (Q15, PS-S5)", async () => {
    await renderList([
      pauseApprovalFixture({
        ...R1,
        commitments: [
          { kind: "visible", commitmentId: "c-1", habitName: "Gym", icon: null },
          { kind: "hidden", commitmentId: "c-2" },
        ],
      }),
      pauseApprovalFixture({
        id: "pause-2",
        requester: { memberId: "member-sofia", displayName: "Sofia" },
        commitments: [
          { kind: "hidden", commitmentId: "c-8" },
          { kind: "hidden", commitmentId: "c-9" },
        ],
      }),
    ]);
    expect(
      await screen.findByText("Andrea pidió pausar Gym y un objetivo privado"),
    ).toBeInTheDocument();
    expect(screen.getByText("Sofia pidió pausar 2 objetivos privados")).toBeInTheDocument();
  });

  it("sends the answer, then shows it and lets the viewer change it while pending (Q3, PS-S1)", async () => {
    const { deps } = await renderList([R1]);
    await userEvent.click(await screen.findByRole("button", { name: "Aprobar" }));
    expect(await screen.findByText("Aprobaste")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aprobar" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Rechazar" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await userEvent.click(screen.getByRole("button", { name: "Rechazar" }));
    expect(await screen.findByText("Rechazaste")).toBeInTheDocument();
    expect(deps.api.pauseCommands).toEqual([
      { method: "respondToPause", args: ["pause-r1", "approve"] },
      { method: "respondToPause", args: ["pause-r1", "reject"] },
    ]);
    // Still pending: the card stays.
    expect(screen.getByRole("article")).toBeInTheDocument();
  });

  it("shows the viewer's earlier answer on first load", async () => {
    await renderList([pauseApprovalFixture({ ...R1, myResponse: "reject" })]);
    expect(await screen.findByText("Rechazaste")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rechazar" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("says a late answer arrived after the decision, without applying it (PS-9)", async () => {
    const { deps } = await renderList([R1]);
    deps.api.failNext("respondToPause", new ApiError("PauseAlreadyDecided", 409, null));
    await userEvent.click(await screen.findByRole("button", { name: "Rechazar" }));
    expect(await screen.findByText("Esta solicitud ya se decidió.")).toBeInTheDocument();
    expect(screen.queryByText("Rechazaste")).not.toBeInTheDocument();
  });

  it("drops the card once a refetch no longer lists the request as pending", async () => {
    const { deps } = await renderList([R1]);
    await screen.findByRole("article");
    deps.api.setMyPauseRequests(myPauseRequestsFixture({ awaitingMe: [] }));
    await deps.queryClient.refetchQueries({ queryKey: ["pauseRequests"] });
    await waitFor(() => expect(screen.queryByRole("article")).not.toBeInTheDocument());
  });

  it("answers are off without a connection (no write queue)", async () => {
    await renderList([R1], { online: false });
    expect(await screen.findByRole("button", { name: "Aprobar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Rechazar" })).toBeDisabled();
  });

  it("renders nothing when nobody is waiting, and never an activity feed (Q8)", async () => {
    const { deps } = await renderList([]);
    await waitFor(() => expect(deps.api.calls.getMyPauseRequests).toBeGreaterThan(0));
    expect(screen.queryByText("Pausas por aprobar")).not.toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(screen.queryByText(/Actividad del círculo/)).not.toBeInTheDocument();
  });

  it("explains a failed load and offers to retry", async () => {
    const view = renderInProviders(<PauseApprovalList />);
    view.deps.api.failNext("getMyPauseRequests", new ApiError("NetworkError", 0, null));
    await view.deps.queryClient.refetchQueries({ queryKey: ["pauseRequests"] });
    expect(
      await screen.findByText("No pudimos cargar las solicitudes de pausa."),
    ).toBeInTheDocument();
    view.deps.api.setMyPauseRequests(myPauseRequestsFixture({ awaitingMe: [R1] }));
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("article")).toBeInTheDocument();
  });
});
