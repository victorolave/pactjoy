import { describe, expect, it } from "vitest";
import { completedItemFixture } from "../../../testing/fixtures/social.ts";
import { deviceDate, groupFeed } from "./feed-groups.ts";

const on = (onDate: string, key = `session:c:${onDate}`) => completedItemFixture({ onDate, key });

describe("deviceDate", () => {
  it("is the calendar date of the instant on the device", () => {
    const noon = new Date(2026, 9, 3, 12, 0).getTime();
    expect(deviceDate(noon)).toBe("2026-10-03");
    expect(deviceDate(new Date(2026, 0, 5, 0, 30).getTime())).toBe("2026-01-05");
  });
});

describe("groupFeed", () => {
  const today = "2026-10-10";

  it("splits into Hoy, Esta semana and Antes by onDate, keeping the order", () => {
    const items = [
      on("2026-10-10", "a"),
      on("2026-10-09", "b"),
      on("2026-10-04", "c"),
      on("2026-10-03", "d"),
      on("2026-09-20", "e"),
    ];
    expect(groupFeed(items, today).map((g) => [g.title, g.items.map((i) => i.key)])).toEqual([
      ["Hoy", ["a"]],
      ["Esta semana", ["b", "c"]],
      ["Antes", ["d", "e"]],
    ]);
  });

  it("drops empty groups", () => {
    expect(groupFeed([on("2026-09-01")], today).map((g) => g.title)).toEqual(["Antes"]);
    expect(groupFeed([], today)).toEqual([]);
  });

  it("treats a date ahead of the device (a season in another time zone) as today", () => {
    expect(groupFeed([on("2026-10-11")], today).map((g) => g.title)).toEqual(["Hoy"]);
  });

  it("counts six days back as this week and the seventh as before", () => {
    expect(groupFeed([on("2026-10-04")], today)[0]?.title).toBe("Esta semana");
    expect(groupFeed([on("2026-10-03")], today)[0]?.title).toBe("Antes");
  });
});
