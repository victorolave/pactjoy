import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApiError } from "../ports/api-error.ts";
import { NO_CIRCLE } from "../testing/fixtures/circle.ts";
import { noCircleTodayFixture } from "../testing/fixtures/today.ts";
import { renderApp } from "../testing/render.tsx";

const NAME_STEP = "¿Cómo te verá tu círculo?";
const fresh = { today: noCircleTodayFixture(), myCircle: NO_CIRCLE } as const;

describe("OnboardingGate", () => {
  it("sends a signed-in user with no circle and no name draft to the name step (OB-S1 without the carousel)", async () => {
    const app = renderApp({ ...fresh });
    expect(await screen.findByRole("heading", { name: NAME_STEP })).toBeInTheDocument();
    expect(app.location()).toBe("/welcome/name");
    expect(screen.queryByRole("navigation", { name: "Principal" })).not.toBeInTheDocument();
  });

  it("leaves a user with a name draft on Today, which offers the way to a circle", async () => {
    const app = renderApp({ ...fresh, nameDraft: "Andrea" });
    expect(
      await screen.findByRole("heading", { name: "Aún no estás en un círculo" }),
    ).toBeInTheDocument();
    expect(app.location()).toBe("/");
  });

  it("does not show onboarding to a member, and sends them home from the name step (OB-S8)", async () => {
    const app = renderApp({ path: "/welcome/name" });
    await waitFor(() => expect(app.location()).toBe("/"));
    expect(screen.queryByRole("heading", { name: NAME_STEP })).not.toBeInTheDocument();
  });

  it("fails open when /me/circle fails: the app renders, nobody is trapped", async () => {
    const app = renderApp({
      ...fresh,
      myCircleFailures: [new ApiError("Internal", 500, null)],
    });
    expect(
      await screen.findByRole("heading", { name: "Aún no estás en un círculo" }),
    ).toBeInTheDocument();
    expect(app.location()).toBe("/");
  });

  it("fails open offline with nothing cached", async () => {
    const app = renderApp({
      ...fresh,
      online: false,
      myCircleFailures: [new ApiError("NetworkError", 0, null)],
    });
    expect(await screen.findByRole("navigation", { name: "Principal" })).toBeInTheDocument();
    expect(app.location()).toBe("/");
  });
});
