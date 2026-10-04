import { describe, expect, it } from "vitest";
import type { MyCircle } from "../../../ports/pactjoy-api.ts";
import { pairCircleFixture, soloCircleFixture } from "../../../testing/fixtures/circle.ts";
import { leaveCopy } from "./leave-copy.ts";

type Season = NonNullable<MyCircle["season"]>;
const season = (phase: Season["phase"]): Season => ({
  id: "season-1",
  phase,
  lengthWeeks: 8,
  week: phase === "active" ? 3 : null,
  approvalCount: 1,
});
const circleOf = (myCircle: MyCircle) => {
  if (myCircle.circle === null) throw new Error("the fixture has a circle");
  return myCircle.circle;
};
const solo = circleOf(soloCircleFixture());
const pair = circleOf(pairCircleFixture());
const trio = {
  ...pair,
  members: [
    ...pair.members,
    {
      id: "member-bruno",
      displayName: "Bruno",
      joinedAt: "2026-09-29T12:00:00.000Z",
      isYou: false,
    },
  ],
};

describe("what the leave sheet says", () => {
  it("names the circle in the title", () => {
    expect(leaveCopy(pair, null).title).toBe("¿Salir de Andrea & Victor?");
  });

  it("says the pact is discarded and the approvals reset while the pact is open", () => {
    const { body } = leaveCopy(pair, season("pactOpen"));
    expect(body).toContain("tus compromisos se descartarán");
    expect(body).toContain("aprobaciones");
  });

  it("does not talk about the standings before the season starts", () => {
    const { body } = leaveCopy(pair, season("notStarted"));
    expect(body).toContain("todavía no empieza");
    expect(body).toContain("el pacto aprobado se conserva");
    expect(body).not.toContain("registraste");
    expect(body).not.toContain("clasificación");
  });

  it("says the standings are hidden when one person would stay mid-season", () => {
    const { body } = leaveCopy(pair, season("active"));
    expect(body).toContain("Saldrás de la clasificación");
    expect(body).toContain("Andrea seguirá con sus métricas");
    expect(body).toContain("la clasificación se ocultará");
  });

  it("says the standings go on for the others when two or more would stay", () => {
    const { body } = leaveCopy(trio, season("active"));
    expect(body).toContain("la clasificación sigue para quienes se quedan");
    expect(body).not.toContain("se ocultará");
  });

  it("does not mention the standings once the season has ended", () => {
    const { body } = leaveCopy(pair, season("ended"));
    expect(body).toContain("ya terminó");
    expect(body).not.toContain("clasificación");
  });

  it("explains that rejoining needs an invite when there is no season", () => {
    expect(leaveCopy(pair, null).body).toContain("código de invitación");
  });

  it("says the circle is archived when the viewer is the last member", () => {
    expect(leaveCopy(solo, null).body).toContain("el círculo se archiva");
    expect(leaveCopy(solo, season("active")).body).not.toContain("clasificación");
  });

  it("adds that the open season is discarded when the last member leaves a pact still open", () => {
    expect(leaveCopy(solo, season("pactOpen")).body).toContain("se descarta la temporada");
  });
});
