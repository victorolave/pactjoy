import { describe, expect, it } from "vitest";
import type { MyCircle } from "../../../ports/pactjoy-api.ts";
import { seasonStatus } from "./season-status.ts";

const season = (
  phase: "pactOpen" | "notStarted" | "active" | "ended",
  extra: Partial<NonNullable<MyCircle["season"]>> = {},
): NonNullable<MyCircle["season"]> => ({
  id: "season-1",
  phase,
  lengthWeeks: 8,
  week: null,
  approvalCount: 0,
  ...extra,
});

describe("season status of the Circle tab", () => {
  it("counts the approvals while the pact is open", () => {
    expect(seasonStatus(season("pactOpen", { approvalCount: 1 }), 2)).toEqual({
      badge: "Pacto abierto",
      tone: "pending",
      detail: "1 de 2 lo han aprobado",
    });
  });

  it("says the pact is approved before the season starts", () => {
    expect(seasonStatus(season("notStarted"), 2)).toMatchObject({
      badge: "Pacto aprobado",
      detail: "Temporada de 8 semanas por empezar",
    });
  });

  it("shows the week of the running season", () => {
    expect(seasonStatus(season("active", { week: 5 }), 2)).toMatchObject({
      badge: "Pacto activo",
      tone: "success",
      detail: "Semana 5 de 8",
    });
  });

  it("closes the story when the season ended", () => {
    expect(seasonStatus(season("ended"), 2)).toEqual({
      badge: "Temporada terminada",
      tone: "neutral",
      detail: null,
    });
  });
});
