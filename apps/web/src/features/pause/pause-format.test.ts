import { describe, expect, it } from "vitest";
import {
  autoApproveText,
  commitmentList,
  PAUSE_REASON_OPTIONS,
  peersUnchangedText,
  periodText,
  perOpportunityText,
  reasonLabel,
  remainingApprovalText,
  weekOpportunitiesText,
} from "./pause-format.ts";

describe("pause copy helpers", () => {
  it("labels every reason in Spanish, with the design's chip order", () => {
    expect(PAUSE_REASON_OPTIONS.map((o) => o.label)).toEqual([
      "Salud o lesión",
      "Viaje",
      "Trabajo",
      "Otro",
    ]);
    expect(reasonLabel("health")).toBe("Salud o lesión");
    expect(reasonLabel("travel")).toBe("Viaje");
  });

  it("says the exact auto-approval time in the season's time zone (PS-6, R1)", () => {
    // 2026-10-16T14:12Z is Friday 09:12 in Bogotá (UTC-5).
    expect(autoApproveText("2026-10-16T14:12:00.000Z", "America/Bogota")).toBe(
      "viernes 16 a las 9:12",
    );
    // The same instant is already Friday evening 23:12 in Kolkata (UTC+5:30 -> 19:42), so the zone matters.
    expect(autoApproveText("2026-10-16T14:12:00.000Z", "Asia/Kolkata")).toBe(
      "viernes 16 a las 19:42",
    );
    // A local day boundary (PL-S12): 02:30Z on the 17th is still the 16th in Bogotá.
    expect(autoApproveText("2026-10-17T02:30:00.000Z", "America/Bogota")).toBe(
      "viernes 16 a las 21:30",
    );
  });

  it("describes the period: today or a date, until a date or open", () => {
    expect(periodText("2026-10-02", null, "2026-10-02")).toBe("desde hoy, hasta que la reanudes");
    expect(periodText("2026-10-05", "2026-10-09", "2026-10-02")).toBe("del 5 al 9 de octubre");
    expect(periodText("2026-10-30", "2026-11-03", "2026-10-02")).toBe(
      "del 30 de octubre al 3 de noviembre",
    );
    expect(periodText("2026-10-05", null, "2026-10-02")).toBe(
      "desde el 5 de octubre, hasta que la reanudes",
    );
    expect(periodText("2026-10-02", "2026-10-02", "2026-10-02")).toBe("solo hoy");
  });

  it("counts down the 48 h: hours, then minutes, then 'unos instantes'", () => {
    const at = "2026-10-04T14:12:00.000Z";
    const hours = (h: number) => Date.parse(at) - h * 3_600_000;
    expect(remainingApprovalText(at, hours(48))).toBe("en 48 h");
    expect(remainingApprovalText(at, hours(5.5))).toBe("en 6 h");
    expect(remainingApprovalText(at, Date.parse(at) - 20 * 60_000)).toBe("en 20 min");
    expect(remainingApprovalText(at, Date.parse(at) - 10_000)).toBe("en unos instantes");
    expect(remainingApprovalText(at, Date.parse(at) + 1)).toBe("en unos instantes");
  });

  it("lists Commitment names with commas and a final 'y'", () => {
    expect(commitmentList(["Meditar"])).toBe("Meditar");
    expect(commitmentList(["Meditar", "Leer"])).toBe("Meditar y Leer");
    expect(commitmentList(["Meditar", "Leer", "Correr"])).toBe("Meditar, Leer y Correr");
  });

  it("counts the week's opportunities, in the singular for one", () => {
    expect(weekOpportunitiesText(3)).toBe("Esta semana tendrás 3 oportunidades.");
    expect(weekOpportunitiesText(1)).toBe("Esta semana tendrás 1 oportunidad.");
  });

  it("shows what each opportunity is worth as weight points over opportunities, unreduced", () => {
    expect(perOpportunityText("Gym", 300, 24)).toBe(
      "La pausa de Gym repartió el valor de sus oportunidades entre las que quedan: cada una vale ahora 300 ÷ 24.",
    );
  });

  it("says whose points did not change, by how many peers there are", () => {
    expect(peersUnchangedText([])).toBeNull();
    expect(peersUnchangedText(["Andrea"])).toBe("El de Andrea no cambia.");
    expect(peersUnchangedText(["Ana", "Beto"])).toBe("Los de Ana y Beto no cambian.");
    expect(peersUnchangedText(["Ana", "Beto", "Carla"])).toBe(
      "Los de Ana, Beto y Carla no cambian.",
    );
    expect(peersUnchangedText(["Ana", "Beto", "Carla", "Dani"])).toBe("El de los demás no cambia.");
    expect(peersUnchangedText(["A", "B", "C", "D", "E"])).toBe("El de los demás no cambia.");
  });
});
