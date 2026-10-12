import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  myPauseRequestsFixture,
  pauseBudgetFixture,
  pauseRequestFixture,
} from "../../../testing/fixtures/pause.ts";
import { type RenderAppOptions, renderInProviders } from "../../../testing/render.tsx";
import { CommitmentPauseSection } from "./CommitmentPauseSection.tsx";

async function renderSection(
  view: ReturnType<typeof myPauseRequestsFixture>,
  commitmentId = "commitment-1",
  options: RenderAppOptions = {},
) {
  const rendered = renderInProviders(
    <CommitmentPauseSection commitmentId={commitmentId} />,
    options,
  );
  rendered.deps.api.setMyPauseRequests(view);
  await rendered.deps.queryClient.refetchQueries({ queryKey: ["pauseRequests"] });
  return rendered;
}

describe("the pause entry point on a Commitment (design 24a/24b, PS-1)", () => {
  it("offers 'Pausar este compromiso' with the days left, only on the viewer's own Commitment", async () => {
    await renderSection(
      myPauseRequestsFixture({
        budgets: [pauseBudgetFixture({ commitmentId: "commitment-1", remainingDays: 9 })],
      }),
    );
    expect(
      await screen.findByRole("button", { name: "Pausar este compromiso" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Te quedan 9 días de pausa")).toBeInTheDocument();
  });

  it("opens the request sheet with that Commitment preselected", async () => {
    await renderSection(myPauseRequestsFixture());
    await userEvent.click(await screen.findByRole("button", { name: "Pausar este compromiso" }));
    const dialog = await screen.findByRole("dialog", { name: "Pausar un compromiso" });
    expect(dialog).toBeInTheDocument();
    const chip = await screen.findByRole("button", { name: "Meditar" });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("shows the pending view instead when a request covers it (and no second request)", async () => {
    await renderSection(myPauseRequestsFixture({ mine: [pauseRequestFixture()] }));
    expect(await screen.findByRole("heading", { name: "Pausa en espera" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Pausar este compromiso" }),
    ).not.toBeInTheDocument();
  });

  it("ignores requests that are decided or cover other Commitments", async () => {
    await renderSection(
      myPauseRequestsFixture({
        mine: [
          pauseRequestFixture({ id: "p-done", status: "rejected" }),
          pauseRequestFixture({
            id: "p-other",
            commitments: [
              { commitmentId: "commitment-2", habitName: "Leer", icon: null, resumedOn: null },
            ],
          }),
        ],
      }),
    );
    expect(
      await screen.findByRole("button", { name: "Pausar este compromiso" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Pausa en espera" })).not.toBeInTheDocument();
  });

  it("shows nothing for a Commitment that is not the viewer's, or without a running season", async () => {
    await renderSection(myPauseRequestsFixture(), "commitment-of-a-peer");
    await waitFor(() => expect(screen.queryByRole("button")).not.toBeInTheDocument());
    expect(screen.queryByText(/Te quedan/)).not.toBeInTheDocument();
  });

  it("is off without a connection", async () => {
    await renderSection(myPauseRequestsFixture(), "commitment-1", { online: false });
    expect(await screen.findByRole("button", { name: "Pausar este compromiso" })).toBeDisabled();
  });
});
