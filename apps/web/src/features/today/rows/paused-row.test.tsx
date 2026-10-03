import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { dayRowFixture, weekRowFixture } from "../../../testing/fixtures/today.ts";
import { PausedRow } from "./PausedRow.tsx";

describe("paused and on-hold rows (TO-R5, TO-S8)", () => {
  it.each([
    ["paused", "En pausa"],
    ["onHold", "En espera"],
  ] as const)("shows %s as a read-only row tagged %s, without controls", (state, tag) => {
    render(<PausedRow row={dayRowFixture({ opportunity: { state, graceUntil: null } })} />);
    expect(screen.getByRole("heading", { name: "Meditar" })).toBeInTheDocument();
    expect(screen.getByText(tag)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows a paused week row the same way, with no progress bar", () => {
    render(
      <PausedRow
        row={weekRowFixture({ opportunity: { state: "paused", graceUntil: null }, progress: null })}
      />,
    );
    expect(screen.getByRole("heading", { name: "Leer" })).toBeInTheDocument();
    expect(screen.getByText("En pausa")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});
