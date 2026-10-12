import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../../ports/api-error.ts";
import { baselineOfferFixture, pendingReviewFixture } from "../../../testing/fixtures/review.ts";
import { activeTodayFixture } from "../../../testing/fixtures/today.ts";
import { renderInProviders } from "../../../testing/render.tsx";
import { BaselineOffer } from "./BaselineOffer.tsx";
import { ReviewNotice } from "./ReviewNotice.tsx";
import { ReviewTodayCard } from "./ReviewTodayCard.tsx";

function LocationProbe() {
  const { pathname } = useLocation();
  return <span data-testid="where">{pathname}</span>;
}

const withReview = (overrides: Record<string, unknown>) =>
  ({ ...activeTodayFixture(), ...overrides }) as ReturnType<typeof activeTodayFixture>;

const render = (ui: ReactNode, today = activeTodayFixture(), options = {}) =>
  renderInProviders(ui, { today, ...options });

describe("ReviewTodayCard", () => {
  it("offers the pending interim review with its weeks and the day it lapses", async () => {
    render(<ReviewTodayCard />, withReview({ pendingReview: pendingReviewFixture() }));
    expect(await screen.findByText("Revisión de las semanas 3 y 4")).toBeInTheDocument();
    expect(screen.getByText("Solo para ti, unos 60 segundos.")).toBeInTheDocument();
    expect(screen.getByText("Hasta el martes 6 de octubre")).toBeInTheDocument();
  });

  it("opens the review of that period from the card", async () => {
    render(
      <>
        <ReviewTodayCard />
        <LocationProbe />
      </>,
      withReview({
        pendingReview: pendingReviewFixture({ periodIndex: 3, firstWeek: 5, lastWeek: 6 }),
      }),
    );
    await userEvent.click(await screen.findByRole("button", { name: "Hacer la revisión" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/review/season-1/3");
  });

  it("names a single week in the singular", async () => {
    render(
      <ReviewTodayCard />,
      withReview({ pendingReview: pendingReviewFixture({ firstWeek: 4, lastWeek: 4 }) }),
    );
    expect(await screen.findByText("Revisión de la semana 4")).toBeInTheDocument();
  });

  it("shows nothing for the closing review: it has no screen yet", async () => {
    const { deps } = render(
      <ReviewTodayCard />,
      withReview({ pendingReview: pendingReviewFixture({ kind: "closing", dueUntil: null }) }),
    );
    await waitFor(() => expect(deps.api.calls.getToday).toBe(1));
    expect(screen.queryByText(/Revisión de/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hacer la revisión" })).not.toBeInTheDocument();
  });

  it("shows nothing when there is nothing to answer", async () => {
    const { deps } = render(<ReviewTodayCard />);
    await waitFor(() => expect(deps.api.calls.getToday).toBe(1));
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("offers the baseline instead, with Responder and Ahora no", async () => {
    render(<ReviewTodayCard />, withReview({ baselineOffer: baselineOfferFixture() }));
    expect(await screen.findByText("Antes de empezar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Responder" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ahora no" })).toBeInTheDocument();
  });
});

describe("BaselineOffer", () => {
  it("opens the baseline questions (period 0) with Responder", async () => {
    render(
      <>
        <BaselineOffer />
        <LocationProbe />
      </>,
      withReview({ baselineOffer: baselineOfferFixture() }),
    );
    await userEvent.click(await screen.findByRole("button", { name: "Responder" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/review/season-1/0");
  });

  it("stores the skip with Ahora no and the offer goes away", async () => {
    const { deps } = render(
      <BaselineOffer />,
      withReview({ baselineOffer: baselineOfferFixture() }),
    );
    await userEvent.click(await screen.findByRole("button", { name: "Ahora no" }));
    await waitFor(() => expect(screen.queryByText("Antes de empezar")).not.toBeInTheDocument());
    expect(deps.api.reviewCommands).toEqual([{ method: "skipBaseline", args: ["season-1"] }]);
  });

  it("keeps the offer and says so when the skip fails", async () => {
    const { deps } = render(
      <BaselineOffer />,
      withReview({ baselineOffer: baselineOfferFixture() }),
    );
    deps.api.failNext("skipBaseline", new ApiError("NetworkError", 0, null));
    await userEvent.click(await screen.findByRole("button", { name: "Ahora no" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No pudimos guardarlo. Revisa tu conexión.",
    );
    expect(screen.getByText("Antes de empezar")).toBeInTheDocument();
  });

  it("cannot be skipped offline", async () => {
    render(<BaselineOffer />, withReview({ baselineOffer: baselineOfferFixture() }), {
      online: false,
    });
    expect(await screen.findByRole("button", { name: "Ahora no" })).toBeDisabled();
  });

  it("renders nothing without an offer", async () => {
    const { deps } = render(<BaselineOffer />);
    await waitFor(() => expect(deps.api.calls.getToday).toBe(1));
    expect(screen.queryByText("Antes de empezar")).not.toBeInTheDocument();
  });
});

describe("ReviewNotice", () => {
  it("tells the Temporada tab a review is waiting, on the same days as the card", async () => {
    render(<ReviewNotice />, withReview({ pendingReview: pendingReviewFixture() }));
    expect(await screen.findByText("Tienes una revisión pendiente")).toBeInTheDocument();
    expect(
      screen.getByText("Revisión de las semanas 3 y 4 · hasta el martes 6 de octubre"),
    ).toBeInTheDocument();
  });

  it("also tells about the baseline", async () => {
    render(<ReviewNotice />, withReview({ baselineOffer: baselineOfferFixture() }));
    expect(await screen.findByText("Puedes responder tu punto de partida")).toBeInTheDocument();
  });

  it("hides the closing review and an empty day", async () => {
    const { deps } = render(
      <ReviewNotice />,
      withReview({ pendingReview: pendingReviewFixture({ kind: "closing", dueUntil: null }) }),
    );
    await waitFor(() => expect(deps.api.calls.getToday).toBe(1));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("opens the review from the notice", async () => {
    render(
      <>
        <ReviewNotice />
        <LocationProbe />
      </>,
      withReview({ pendingReview: pendingReviewFixture() }),
    );
    await userEvent.click(await screen.findByRole("button", { name: "Hacer la revisión" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/review/season-1/2");
  });
});
