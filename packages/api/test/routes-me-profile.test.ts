import { describe, expect, it } from "vitest";
import { presentProfileSummary } from "../src/presenters/profile.ts";
import { createCircleBody } from "../src/testing/index.ts";
import { givenTwoMemberSeason } from "./entries-fixture.ts";
import { setup } from "./harness.ts";

const SHAPE = ["consistency", "habits"];
const CONSISTENCY_KEYS = ["closedSeasons", "counted", "inProgress", "kept", "percent"];
const HABIT_KEYS = ["habitId", "icon", "inCurrentSeason", "name", "stage"];

describe("GET /me/profile (REQ-P1, REQ-P2, REQ-V1)", () => {
  it("401 without a token and with an unknown one", async () => {
    const { call } = setup();
    const none = await call("GET", "/me/profile", null);
    const bad = await call("GET", "/me/profile", "nobody");
    expect([none.status, bad.status]).toEqual([401, 401]);
  });

  it("no circle and no habits is 200 with zeros, not 404", async () => {
    const { call } = setup();
    const res = await call("GET", "/me/profile", "andrea");
    expect([res.status, res.json]).toEqual([
      200,
      {
        data: {
          consistency: { kept: 0, counted: 0, percent: null, closedSeasons: 0, inProgress: false },
          habits: [],
        },
      },
    ]);
  });

  it("no circle still lists the owner's habits as new and out of season", async () => {
    const { call } = setup();
    const created = await call("POST", "/habits", "andrea", { name: "Run" });
    const res = await call("GET", "/me/profile", "andrea");
    expect(res.json.data.habits).toEqual([
      {
        habitId: created.json.data.id,
        name: "Run",
        icon: null,
        stage: "new",
        inCurrentSeason: false,
      },
    ]);
  });

  it("200 carries the exact key set over a circle with a season in progress", async () => {
    const { call, setNow } = await givenTwoMemberSeason();
    setNow(Date.UTC(2023, 10, 22, 17) as never);
    const res = await call("GET", "/me/profile", "andrea");
    expect(res.status).toBe(200);
    expect(Object.keys(res.json.data).sort()).toEqual(SHAPE);
    expect(Object.keys(res.json.data.consistency).sort()).toEqual(CONSISTENCY_KEYS);
    expect(Object.keys(res.json.data.habits[0]).sort()).toEqual(HABIT_KEYS);
    expect(res.json.data.consistency.inProgress).toBe(true);
    expect(res.json.data.habits[0]).toMatchObject({ name: "Run andrea", inCurrentSeason: true });
  });

  it("query parameters are ignored: they cannot address another member", async () => {
    const { call, setNow } = await givenTwoMemberSeason();
    setNow(Date.UTC(2023, 10, 22, 17) as never);
    const plain = await call("GET", "/me/profile", "andrea");
    const spoofed = await call("GET", "/me/profile?userId=victor&memberId=x", "andrea");
    expect([spoofed.status, spoofed.json]).toEqual([200, plain.json]);
  });

  it("there is no route addressing another member", async () => {
    const { call } = setup();
    const circle = await call("POST", "/circles", "andrea", createCircleBody("Crew"));
    for (const path of [
      `/me/profile/${circle.json.data.id}`,
      `/members/${circle.json.data.id}/profile`,
    ]) {
      const res = await call("GET", path, "andrea");
      expect([path, res.status, res.json.error?.code]).toEqual([path, 404, "RouteNotFound"]);
    }
  });
});

describe("presentProfileSummary", () => {
  it("copies every field by name and drops anything else", () => {
    const view = {
      consistency: { kept: 2, counted: 3, percent: 67, closedSeasons: 1, inProgress: true },
      habits: [
        {
          habitId: "h1",
          name: "Run",
          icon: "run",
          stage: "developing",
          inCurrentSeason: false,
          extra: 1,
        },
      ],
      extra: 2,
    };
    const out = presentProfileSummary(view as never);
    expect(out).toEqual({
      consistency: { kept: 2, counted: 3, percent: 67, closedSeasons: 1, inProgress: true },
      habits: [
        { habitId: "h1", name: "Run", icon: "run", stage: "developing", inCurrentSeason: false },
      ],
    });
  });
});
