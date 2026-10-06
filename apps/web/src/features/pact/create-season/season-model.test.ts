import { describe, expect, it } from "vitest";
import {
  reviewCadenceForLength,
  seasonCadenceMessage,
  seasonEndDate,
  seasonEndMessage,
  todayIso,
} from "./season-model.ts";

describe("season-model", () => {
  it("formats calendar date for a timestamp in the given timezone", () => {
    // 2026-08-24 23:00 UTC is 2026-08-24 18:00 in America/Bogota (UTC-5)
    const ms = Date.parse("2026-08-24T23:00:00Z");
    expect(todayIso(ms, "America/Bogota")).toBe("2026-08-24");
    // In Tokyo (UTC+9), it is 2026-08-25 08:00
    expect(todayIso(ms, "Asia/Tokyo")).toBe("2026-08-25");
  });
  it("defaults review cadence based on season duration", () => {
    expect(reviewCadenceForLength(4)).toBe(1);
    expect(reviewCadenceForLength(6)).toBe(2);
    expect(reviewCadenceForLength(8)).toBe(2);
    expect(reviewCadenceForLength(12)).toBe(3);
  });

  it("calculates season end date as (lengthWeeks * 7 - 1) days from start", () => {
    // 8 weeks starting on Tuesday 2026-08-25 ends on Monday 2026-10-19
    expect(seasonEndDate("2026-08-25", 8)).toBe("2026-10-19");
    // 4 weeks starting on 2026-10-01 ends on 2026-10-28
    expect(seasonEndDate("2026-10-01", 4)).toBe("2026-10-28");
  });

  it("formats season end message with end date and starting weekday verbatim from design", () => {
    expect(seasonEndMessage("2026-08-25", 8)).toBe(
      "Termina el lunes 19 de octubre. Las semanas se cuentan desde el martes.",
    );
  });

  it("shows cadence recommendation prefix only when cadence matches length default", () => {
    expect(seasonCadenceMessage(8, 2)).toBe(
      "Recomendada para 8 semanas. Unos 60 segundos para ver cómo vas.",
    );
    expect(seasonCadenceMessage(8, 1)).toBe("Unos 60 segundos para ver cómo vas.");
    expect(seasonCadenceMessage(4, 1)).toBe(
      "Recomendada para 4 semanas. Unos 60 segundos para ver cómo vas.",
    );
    expect(seasonCadenceMessage(4, 2)).toBe("Unos 60 segundos para ver cómo vas.");
    expect(seasonCadenceMessage(12, 3)).toBe(
      "Recomendada para 12 semanas. Unos 60 segundos para ver cómo vas.",
    );
  });
});
