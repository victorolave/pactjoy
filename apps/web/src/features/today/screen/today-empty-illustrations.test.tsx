import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { NoCircle, NoSeason, PactOpen } from "./TodayStates.tsx";

/** The empty states of Today draw an official illustration, not the neutral placeholder block. */
describe("Today empty states: illustrations", () => {
  it.each([
    ["Sin círculo todavía", <NoCircle key="c" />, "invitar-circulo"],
    ["Sin temporada todavía", <NoSeason key="s" circleName="Andrea y Victor" />, "crear-pacto"],
    [
      "Pacto abierto",
      <PactOpen
        key="p"
        model={{
          kind: "pactOpen",
          circleName: "Andrea y Victor",
          lengthWeeks: 8,
          startDate: "2026-10-14",
          seasonId: "s-1",
        }}
      />,
      "crear-pacto",
    ],
  ])("%s shows an image", (alt, element, file) => {
    render(<MemoryRouter>{element}</MemoryRouter>);
    const image = screen.getByRole("img", { name: alt });
    expect(image.tagName).toBe("IMG");
    expect(image.getAttribute("src")).toContain(file);
  });
});
