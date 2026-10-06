import { instant } from "@pactjoy/app";
import { describe, expect, it } from "vitest";
import { createCircleBody } from "../src/testing/index.ts";
import { setup } from "./harness.ts";

const DAILY = {
  unit: "minutes",
  direction: "reach",
  minimum: "10",
  ideal: "30",
  schedule: {
    period: "perSession",
    frequency: { kind: "specificDays", weekdays: [0, 1, 2, 3, 4, 5, 6] },
  },
};
const WEEKLY = { unit: "done", frequency: { kind: "timesPerWeek", times: 3 } };

/** Every key path of a JSON value, arrays collapsed to `[]`: the exact wire shape. */
function shape(value: unknown, path = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((v) => shape(v, `${path}[]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => [
      `${path}.${k}`.replace(/^\./, ""),
      ...shape(v, `${path}.${k}`),
    ]);
  }
  return [];
}
const keys = (value: unknown) => [...new Set(shape(value))].sort();

const BASE = [
  "circle",
  "circle.id",
  "circle.name",
  "season",
  "season.actualStart",
  "season.id",
  "season.lengthWeeks",
  "season.nominalStart",
  "state",
  "timeZone",
  "today",
  "viewerId",
];

const under = (prefix: string, rels: string[]) => [prefix, ...rels.map((r) => `${prefix}.${r}`)];
const MEASURE = [
  "customLabel",
  "precision",
  "schedule",
  "schedule.frequency",
  "schedule.frequency.kind",
  "schedule.frequency.times",
  "schedule.frequency.weekdays",
  "schedule.period",
  "target",
  "target.direction",
  "target.ideal",
  "target.minimum",
  "unit",
];
const ENTRY = ["entryId", "forDate", "note", "value", "value.kind", "value.value"];
const ROW_KEYS = [
  "commitmentId",
  "habitName",
  "kind",
  "privacy",
  "scheduledToday",
  ...under("measure", MEASURE),
  ...under("opportunity", ["graceUntil", "state"]),
  ...under("points", [
    "earned",
    "limitPercents",
    "perOpportunity",
    "perOpportunityExact",
    "perOpportunityExact.denominator",
    "perOpportunityExact.numerator",
  ]),
  ...under("progress", [
    "percent",
    "sessionsDone",
    "sessionsTarget",
    "target",
    "target.direction",
    "target.ideal",
    "target.minimum",
    "value",
  ]),
];
const SCORE = [
  "commitments",
  "commitments[].commitmentId",
  "commitments[].consistency",
  "commitments[].habitId",
  "commitments[].idealCompletion",
  "commitments[].kind",
  "commitments[].points",
  "commitments[].privacy",
  "commitments[].weightPercent",
  ...under("commitments[].measure", MEASURE),
  ...under("commitments[].streak", ["best", "current", "unit"]),
  "consistency",
  "displayName",
  "idealCompletion",
  "kind",
  "memberId",
  "points",
  "scope",
];
const SCORED = [
  "pendingYesterday",
  ...under("rows", []).concat(ROW_KEYS.map((k) => `rows[].${k}`)),
  ...under("standings", [
    "eligibleParticipantCount",
    "kind",
    "rows",
    "rows[].displayName",
    "rows[].memberId",
    "rows[].points",
    "rows[].rank",
  ]),
  ...under("summary", ["daysLeft", "pointsToday", "week", "weekCount", ...under("score", SCORE)]),
];

async function given(startDate: string, commit: boolean) {
  const ctx = setup();
  const circle = await ctx.call("POST", "/circles", "andrea", createCircleBody("Crew"));
  const season = await ctx.call("POST", `/circles/${circle.json.data.id}/seasons`, "andrea", {
    timezone: "America/Bogota",
    startDate,
    lengthWeeks: 4,
  });
  const seasonId: string = season.json.data.id;
  if (commit) {
    let pactRevision = 0;
    const ids: string[] = [];
    for (const measure of [DAILY, WEEKLY]) {
      const habit = await ctx.call("POST", "/habits", "andrea", { name: `H${ids.length}` });
      const added = await ctx.call("POST", `/seasons/${seasonId}/commitments`, "andrea", {
        habitId: habit.json.data.id,
        weightPercent: 50,
        privacy: "visible",
        measure,
      });
      ids.push(added.json.data.commitments.at(-1).id);
      pactRevision = added.json.data.pactRevision;
    }
    await ctx.call("PUT", `/seasons/${seasonId}/approval`, "andrea", {
      expectedPactRevision: pactRevision,
    });
    if (startDate === "2023-11-14") {
      await ctx.call("POST", `/seasons/${seasonId}/entries`, "andrea", {
        commitmentId: ids[0],
        value: { kind: "quantity", value: "30" },
        note: "n",
        clientRequestId: "r1",
      });
    }
  }
  return ctx;
}

describe("GET /me/today emits exactly the documented keys (ADR-0011)", () => {
  it("pactOpen", async () => {
    const { call } = await given("2023-11-14", false);
    const res = await call("GET", "/me/today", "andrea");
    expect(res.json.data.state).toBe("pactOpen");
    expect(keys(res.json.data)).toEqual([...BASE, "myCommitments"].sort());
  });

  it("notStarted", async () => {
    const { call } = await given("2023-11-20", true);
    const res = await call("GET", "/me/today", "andrea");
    expect(res.json.data.state).toBe("notStarted");
    expect(keys(res.json.data)).toEqual(
      [
        ...BASE,
        "myCommitments",
        ...["id", "habitName", "icon", "weightPercent", "maxPoints"].map(
          (key) => `myCommitments[].${key}`,
        ),
      ].sort(),
    );
  });

  it("active, with a day row and a week row", async () => {
    const { call } = await given("2023-11-14", true);
    const res = await call("GET", "/me/today", "andrea");
    expect(res.json.data.rows.map((r: { kind: string }) => r.kind)).toEqual(["day", "week"]);
    const entries = ENTRY.map((k) => `rows[].entries[].${k}`);
    expect(keys(res.json.data)).toEqual([...BASE, ...SCORED, "rows[].entries", ...entries].sort());
  });

  it("active with a pending yesterday item (design 15d)", async () => {
    const { call, setNow } = await given("2023-11-14", true);
    // Two days in: yesterday's daily opportunity has no entry and its grace is open today.
    setNow(instant(Date.UTC(2023, 10, 16, 17)));
    const res = await call("GET", "/me/today", "andrea");
    const items = res.json.data.pendingYesterday;
    expect(items).toHaveLength(1);
    const PENDING = [
      "commitmentId",
      "forDate",
      "graceUntil",
      "habitName",
      "privacy",
      // A pending item is always day-bound: weekdays, never times.
      ...under(
        "measure",
        MEASURE.filter((key) => key !== "schedule.frequency.times"),
      ),
      ...under("points", [
        "earned",
        "limitPercents",
        "perOpportunity",
        "perOpportunityExact",
        "perOpportunityExact.denominator",
        "perOpportunityExact.numerator",
      ]),
    ];
    expect(keys(items[0])).toEqual([...PENDING].sort());
  });

  it("ended", async () => {
    const { call, setNow } = await given("2023-11-14", true);
    setNow(instant(Date.UTC(2023, 11, 12, 17)));
    const res = await call("GET", "/me/today", "andrea");
    expect(res.json.data.state).toBe("ended");
    expect(keys(res.json.data)).toEqual([...BASE, ...SCORED, "rows[].entries"].sort());
  });
});
