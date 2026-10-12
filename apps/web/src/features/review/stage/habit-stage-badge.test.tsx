import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../../ports/api-error.ts";
import { stageFixture } from "../../../testing/fixtures/review.ts";
import { renderInProviders } from "../../../testing/render.tsx";
import { HabitStageBadge } from "./HabitStageBadge.tsx";

const badge = () => <HabitStageBadge seasonId="season-1" commitmentId="c-1" />;

describe("HabitStageBadge (24a, 24b)", () => {
  it.each([
    ["new", "🌱 Nuevo"],
    ["developing", "🌿 En desarrollo"],
    ["integrated", "🌳 Integrado"],
    ["graduated", "🎓 Graduado"],
  ] as const)("shows %s as %s", async (stage, label) => {
    renderInProviders(badge(), { stages: [stageFixture("c-1", stage)] });
    expect(await screen.findByText(label)).toBeInTheDocument();
  });

  it("reads the stage of the commitment it was given, from the API", async () => {
    const { deps } = renderInProviders(badge(), { stages: [stageFixture("c-1", "developing")] });
    await screen.findByText("🌿 En desarrollo");
    expect(deps.api.calls.getCommitmentStage).toBe(1);
  });

  it("shows nothing while loading", async () => {
    renderInProviders(badge(), { stages: [stageFixture("c-1", "new")] });
    expect(screen.queryByText("🌱 Nuevo")).not.toBeInTheDocument();
    await screen.findByText("🌱 Nuevo");
  });

  it("shows nothing when the read fails: the badge is optional", async () => {
    const { deps } = renderInProviders(badge(), {
      stageFailures: [new ApiError("CommitmentNotFound", 404, null)],
    });
    await waitFor(() => expect(deps.api.calls.getCommitmentStage).toBe(1));
    expect(screen.queryByText(/Nuevo|En desarrollo|Integrado|Graduado/)).not.toBeInTheDocument();
  });
});
