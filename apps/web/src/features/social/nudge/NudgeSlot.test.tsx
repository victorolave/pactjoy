import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { feedFixture, nudgeFixture } from "../../../testing/fixtures/social.ts";
import { renderInProviders } from "../../../testing/render.tsx";
import { NudgeSlot } from "./NudgeSlot.tsx";

describe("NudgeSlot (the review's closing step)", () => {
  it("shows the nudge of the cached first page", async () => {
    renderInProviders(<NudgeSlot />, { feedPages: [feedFixture({ nudge: nudgeFixture() })] });
    expect(
      await screen.findByText("A Andrea le está costando más Correr estas semanas."),
    ).toBeInTheDocument();
  });

  it("shows nothing while loading and nothing when the feed has no nudge", async () => {
    const { deps } = renderInProviders(<NudgeSlot />, { feedPages: [feedFixture()] });
    expect(screen.queryByRole("group", { name: "Sugerencia de ánimo" })).not.toBeInTheDocument();
    await waitFor(() => expect(deps.api.calls.feed).toBe(1));
    await waitFor(() => expect(deps.queryClient.isFetching()).toBe(0));
    expect(screen.queryByRole("group", { name: "Sugerencia de ánimo" })).not.toBeInTheDocument();
  });
});
