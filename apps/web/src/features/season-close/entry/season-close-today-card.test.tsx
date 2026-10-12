import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { seasonCloseFixture } from "../../../testing/fixtures/season-close.ts";
import { endedTodayFixture } from "../../../testing/fixtures/today.ts";
import { renderInProviders } from "../../../testing/render.tsx";
import { SeasonCloseTodayCard } from "./SeasonCloseTodayCard.tsx";

function LocationProbe() {
  const { pathname } = useLocation();
  return <span data-testid="where">{pathname}</span>;
}

const ended = (seasonClose: ReturnType<typeof seasonCloseFixture> | null) =>
  ({ ...endedTodayFixture(), seasonClose }) as ReturnType<typeof endedTodayFixture>;

const render = (ui: ReactNode, today: ReturnType<typeof endedTodayFixture>) =>
  renderInProviders(
    <>
      {ui}
      <LocationProbe />
    </>,
    { today },
  );

describe("SeasonCloseTodayCard", () => {
  it("shows nothing on the closing review step: the review card owns it", async () => {
    const { deps } = render(<SeasonCloseTodayCard />, ended(seasonCloseFixture("closingReview")));
    await waitFor(() => expect(deps.api.calls.getToday).toBe(1));
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(/temporada/i)).not.toBeInTheDocument();
  });

  it("shows nothing while the season is running (seasonClose null)", async () => {
    const { deps } = render(<SeasonCloseTodayCard />, ended(null));
    await waitFor(() => expect(deps.api.calls.getToday).toBe(1));
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(/temporada/i)).not.toBeInTheDocument();
  });

  it("says when the results come, with no button yet", async () => {
    render(<SeasonCloseTodayCard />, ended(seasonCloseFixture("resultsSoon")));
    expect(await screen.findByText("Tus resultados llegan pronto.")).toBeInTheDocument();
    expect(screen.getByText("Estarán listos el miércoles 21 de octubre.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("opens the closing flow when it is time to decide", async () => {
    render(<SeasonCloseTodayCard />, ended(seasonCloseFixture("decide")));
    expect(await screen.findByText("Cerramos esta temporada.")).toBeInTheDocument();
    expect(screen.getByText("Mira cómo te fue.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Ver resultados" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/season/season-1/close");
  });

  it("waits for the circle after the member closed, without a way forward yet", async () => {
    render(<SeasonCloseTodayCard />, ended(seasonCloseFixture("waiting")));
    expect(await screen.findByText("Esperando a tu círculo")).toBeInTheDocument();
    expect(
      screen.getByText("Cuando todos cierren, podrán preparar la siguiente."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("offers the next season once the circle may open it", async () => {
    render(
      <SeasonCloseTodayCard />,
      ended(seasonCloseFixture("waiting", { nextSeasonOpen: true })),
    );
    expect(await screen.findByText("Esperando a tu círculo")).toBeInTheDocument();
    expect(screen.getByText("Tu círculo ya puede seguir con la siguiente.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Preparar la siguiente temporada" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/season/new");
  });
});
