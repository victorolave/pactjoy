import { describe, expect, it } from "vitest";
import { longDate } from "./format.ts";

describe("longDate", () => {
  it("writes a Friday in Spanish, capitalised, without a year", () => {
    expect(longDate("2026-10-02")).toBe("Viernes 2 de octubre");
  });

  it("covers every weekday and several months", () => {
    expect(longDate("2026-09-24")).toBe("Jueves 24 de septiembre");
    expect(longDate("2026-09-28")).toBe("Lunes 28 de septiembre");
    expect(longDate("2027-01-01")).toBe("Viernes 1 de enero");
    expect(longDate("2026-12-31")).toBe("Jueves 31 de diciembre");
  });

  it("does not shift the day with the machine's time zone", () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = "Pacific/Auckland";
      expect(longDate("2026-10-02")).toBe("Viernes 2 de octubre");
      process.env.TZ = "Pacific/Pago_Pago";
      expect(longDate("2026-10-02")).toBe("Viernes 2 de octubre");
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it("returns the input untouched when it is not a date", () => {
    expect(longDate("mañana")).toBe("mañana");
  });
});
