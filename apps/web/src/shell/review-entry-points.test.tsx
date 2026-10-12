import type { TodayView } from "@pactjoy/app";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { SeasonDto } from "../ports/wire.ts";
import { pairCircleFixture } from "../testing/fixtures/circle.ts";
import {
  baselineOfferFixture,
  interimItemOneFixture,
  pendingReviewFixture,
} from "../testing/fixtures/review.ts";
import { seasonCloseFixture } from "../testing/fixtures/season-close.ts";
import { activeSeasonProgress } from "../testing/fixtures/season-progress.ts";
import { activeTodayFixture, pactOpenTodayFixture } from "../testing/fixtures/today.ts";
import { renderApp } from "../testing/render.tsx";

const review = (overrides: Record<string, unknown>): TodayView =>
  ({ ...activeTodayFixture(), ...overrides }) as TodayView;

const notStarted = (overrides: Record<string, unknown>): TodayView => {
  const base = pactOpenTodayFixture();
  return {
    ...base,
    state: "notStarted",
    season: { ...base.season, actualStart: "2026-10-03" },
    ...overrides,
  } as TodayView;
};

describe("the review on Today", () => {
  it("shows the pending interim review as a card that opens the flow", async () => {
    const app = renderApp({
      today: review({ pendingReview: pendingReviewFixture() }),
      reviews: [{ seasonId: "season-1", periodIndex: 2, draft: interimItemOneFixture() }],
    });
    expect(await screen.findByText("Revisión de las semanas 3 y 4")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Hacer la revisión" }));
    expect(app.location()).toBe("/review/season-1/2");
    expect(
      await screen.findByRole("heading", { name: "Así fueron tus dos últimas semanas" }),
    ).toBeInTheDocument();
  });

  it("offers the closing review once, with no season-close card next to it", async () => {
    const app = renderApp({
      today: review({
        state: "ended",
        pendingReview: pendingReviewFixture({ kind: "closing", periodIndex: 4, dueUntil: null }),
        seasonClose: seasonCloseFixture("closingReview"),
      }),
    });
    expect(await screen.findByText("Revisión de cierre")).toBeInTheDocument();
    expect(screen.getAllByText("Revisión de cierre")).toHaveLength(1);
    expect(screen.queryByText("Cerramos esta temporada.")).not.toBeInTheDocument();
    expect(screen.queryByText("Tus resultados llegan pronto.")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Hacer la revisión" }));
    expect(app.location()).toBe("/review/season-1/4");
  });

  it("shows the season-close card, not the review card, once the closing review is done", async () => {
    renderApp({
      today: review({
        state: "ended",
        pendingReview: null,
        seasonClose: seasonCloseFixture("decide"),
      }),
    });
    expect(await screen.findByText("Cerramos esta temporada.")).toBeInTheDocument();
    expect(screen.queryByText("Revisión de cierre")).not.toBeInTheDocument();
  });

  it("offers the baseline before the season starts", async () => {
    renderApp({ today: notStarted({ baselineOffer: baselineOfferFixture() }) });
    expect(await screen.findByText("Tu punto de partida")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ahora no" })).toBeInTheDocument();
  });

  it("shows no card on an ordinary day", async () => {
    renderApp({ today: activeTodayFixture() });
    await screen.findByRole("heading", { name: /Hola/ });
    expect(screen.queryByText(/Revisión de/)).not.toBeInTheDocument();
    expect(screen.queryByText("Tu punto de partida")).not.toBeInTheDocument();
  });

  it("drops the card once the review is skipped", async () => {
    renderApp({ today: notStarted({ baselineOffer: baselineOfferFixture() }) });
    await userEvent.click(await screen.findByRole("button", { name: "Ahora no" }));
    await waitFor(() => expect(screen.queryByText("Tu punto de partida")).not.toBeInTheDocument());
  });
});

const CURRENT = {
  id: "season-1",
  phase: "active",
  lengthWeeks: 8,
  week: 5,
  approvalCount: 2,
  nextSeasonOpen: false,
} as const;

describe("the review notice in Temporada", () => {
  const temporada = (today: TodayView) => {
    const app = renderApp({
      path: "/season",
      today,
      myCircle: pairCircleFixture(CURRENT),
      nameDraft: "Victor",
    });
    app.deps.api.progress.setSeasonProgress("season-1", activeSeasonProgress({ memberCount: 2 }));
    return app;
  };

  it("tells the member a review is waiting, on the same days as the Today card", async () => {
    temporada(review({ pendingReview: pendingReviewFixture() }));
    expect(await screen.findByText("Tienes una revisión pendiente")).toBeInTheDocument();
    expect(
      screen.getByText("Revisión de las semanas 3 y 4 · hasta el martes 6 de octubre"),
    ).toBeInTheDocument();
  });

  it("shows the closing review there too and opens it", async () => {
    const app = temporada(
      review({
        state: "ended",
        pendingReview: pendingReviewFixture({ kind: "closing", periodIndex: 4, dueUntil: null }),
        seasonClose: seasonCloseFixture("closingReview"),
      }),
    );
    expect(await screen.findByText("Tienes una revisión pendiente")).toBeInTheDocument();
    expect(screen.getByText("Revisión de cierre")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Hacer la revisión" }));
    expect(app.location()).toBe("/review/season-1/4");
  });

  it("shows nothing when nothing is due", async () => {
    temporada(activeTodayFixture());
    await screen.findByRole("heading", { name: /Semana 5 de 8/ });
    expect(screen.queryByText("Tienes una revisión pendiente")).not.toBeInTheDocument();
  });
});

const closedSeason = (): SeasonDto =>
  ({
    id: "season-1",
    circleId: "circle-1",
    timeZone: "UTC",
    nominalStart: "2026-10-07",
    actualStart: "2026-10-07",
    lengthWeeks: 8,
    reviewCadenceWeeks: 2,
    status: "active",
    approvals: [{ memberId: "member-victor", approvedAt: "2026-10-06T12:00:00.000Z" }],
    pactClosedAt: "2026-10-06T12:00:00.000Z",
    createdAt: "2026-10-06T12:00:00.000Z",
    version: 1,
    pactRevision: 0,
    commitments: [],
  }) as unknown as SeasonDto;

describe("the baseline offer on the closed pact (14a)", () => {
  it("offers Responder and Ahora no below the celebration, and Continuar still goes to Today", async () => {
    const app = renderApp({
      path: "/season/season-1/pact",
      myCircle: pairCircleFixture(),
      today: notStarted({ baselineOffer: baselineOfferFixture() }),
      now: Date.parse("2026-10-06T12:00:00Z"),
    });
    app.deps.api.setPactResponse("getSeason", closedSeason());
    expect(await screen.findByRole("heading", { name: "Pacto cerrado" })).toBeInTheDocument();
    const offer = (await screen.findByText("Tu punto de partida")).closest("div") as HTMLElement;
    expect(
      within(offer.parentElement as HTMLElement).getByRole("button", { name: "Responder" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await waitFor(() => expect(app.location()).toBe("/"));
  });

  it("shows no offer when there is none", async () => {
    const app = renderApp({
      path: "/season/season-1/pact",
      myCircle: pairCircleFixture(),
      today: notStarted({}),
      now: Date.parse("2026-10-06T12:00:00Z"),
    });
    app.deps.api.setPactResponse("getSeason", closedSeason());
    await screen.findByRole("heading", { name: "Pacto cerrado" });
    expect(screen.queryByText("Tu punto de partida")).not.toBeInTheDocument();
  });
});
